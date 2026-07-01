"use client";

// Relying-app OIDC authorize ceremony (spec 230) — the home SPA view shown when the browser
// lands on `/?client_id=…`. Ensures the reader is connected, then mints a site-login delegation
// (person SA → the registry delegate) signed with their OWN credential — the home holds no key —
// and redirects back to the relying app with an auth code.
import { useEffect, useRef, useState } from "react";
import { useSession, type Via } from "@/context/session";
import type { Address } from "@/lib/types";
import { secureSocialHome } from "@/lib/vault-key";
import { createPersonTreasury, signHashForVia } from "@/lib/connect";
import { buildUnsignedPaymentDelegation, OPEN_DELEGATION, toWire, type DelegationWire } from "@/lib/delegation";
import { getClient, getClientPaymentConfig } from "@/lib/oidc-clients";
import { chargePayment } from "@/lib/pay";
import { CONTRACTS } from "@/lib/chain";
import {
  beginEnrollmentGrant,
  submitEnrollGrant,
  deliverEnrollCode,
  deliverEnrollError,
  issueSiteDelegation,
  issuePaymentDelegation,
  stashPendingEnroll,
  clearPendingEnroll,
  type EnrollReq,
} from "@/lib/enroll";

const CREDENTIALS: { via: Via; label: string }[] = [
  { via: "passkey", label: "Passkey" },
  { via: "google", label: "Google" },
  { via: "youversion", label: "YouVersion" },
  { via: "wallet", label: "Wallet" },
];

// A signing failure caused by a stale/expired custody session — the reader must reconnect for a
// fresh AgentSession token (a restored localStorage session can hold an expired token).
const SESSION_STALE = /expired|invalid session|custody session|sign in again|no live custody/i;

export default function AuthorizeCeremony({ enroll }: { enroll: EnrollReq }) {
  const { phase, identity, token, signIn, signOut, markDeployed, justConnected } = useSession();
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const ran = useRef(false);

  // x402 (spec 272): for the `x402-pay` template, provision/resolve the reader's person-treasury,
  // mint + sign a capped person-treasury → payee payment delegation, run the first charge in the
  // ceremony (all-custodian, gasless), and — for a subscription — mint a standing pull mandate. The
  // payee + caps come from the SERVER registry (getClientPaymentConfig), not the Explorer.
  async function runPayment(): Promise<{ paymentDelegation?: DelegationWire; pullDelegation?: DelegationWire; settlementHash?: string; treasury?: string }> {
    const id = identity!;
    const client = getClient(enroll.clientId);
    const pc = client ? getClientPaymentConfig(client) : null;
    if (!pc) throw new Error("This app isn't configured for payments.");
    const requested = BigInt(enroll.payAmount || "0");
    if (requested <= 0n) throw new Error("No payment amount was requested.");
    const cap = BigInt(pc.maxAmountPerCharge);
    const perCharge = requested < cap ? requested : cap; // never exceed the registry cap
    const payee = pc.payee as Address;
    const asset = CONTRACTS.mockUsdc as Address;

    setStatus("Setting up your treasury…");
    const t = await createPersonTreasury({ name: id.name ?? null, personSA: id.address as Address, via: id.via, token: token ?? undefined });
    if (!t.ok) throw new Error(`Treasury setup failed: ${t.error}`);
    const treasury = t.agent;

    setStatus("Authorize the payment…");
    const { delegation: payD, digest } = buildUnsignedPaymentDelegation(treasury, OPEN_DELEGATION, payee, {
      maxAmountPerCharge: perCharge, maxAggregate: BigInt(pc.maxAggregate),
    });
    const signTreasury = await signHashForVia(id.via, treasury, token ?? undefined); // ERC-1271 vs the treasury
    payD.signature = await signTreasury(digest);
    const paymentDelegation = toWire(payD);

    setStatus("Charging your treasury…");
    const signPerson = await signHashForVia(id.via, id.address as Address, token ?? undefined); // person SA redeems
    const charged = await chargePayment(id.address as Address, payD, signPerson, { payee, asset, amount: perCharge, edition: "lbsb" });
    if (!charged.ok) throw new Error(`Charge failed: ${charged.error}`);

    let pullDelegation: DelegationWire | undefined;
    if (enroll.subPeriod) {
      pullDelegation = await issuePaymentDelegation(treasury, payee, payee, id.via, token ?? undefined, {
        maxAmountPerCharge: perCharge, maxAggregate: perCharge * 12n, windowSeconds: enroll.subPeriod, maxRedemptionsPerWindow: 1,
      });
    }
    return { paymentDelegation, pullDelegation, settlementHash: charged.settlementHash, treasury };
  }

  async function authorize() {
    if (ran.current) return;
    ran.current = true;
    setError("");
    try {
      if (!identity) throw new Error("not connected");
      if (!identity.deployed) {
        // The delegation is signed via ERC-1271, which needs the delegator SA deployed on-chain.
        // Social homes are counterfactual until secured — deploy it now (paymaster-sponsored,
        // signed server-side by the custody session; no user gesture). Passkey/wallet homes deploy
        // at connect, so an undeployed one there is unexpected → tell the member to open their home.
        if (identity.via === "google" || identity.via === "youversion") {
          setStatus("Securing your home on-chain…");
          const sec = await secureSocialHome(token ?? "");
          if (!sec.ok) throw new Error(sec.error);
          markDeployed();
        } else {
          throw new Error("Your home isn't deployed on-chain yet — open your home once, then retry.");
        }
      }
      setStatus("Requesting authorization…");
      const { grant_id, delegate } = await beginEnrollmentGrant(enroll, identity.name ?? "");
      setStatus("Sign to authorize this app to read your vault…");
      const wire = await issueSiteDelegation(identity.address as Address, delegate, identity.via, token ?? undefined);
      // x402-pay ALSO mints a payment delegation + first charge on top of the site-login (vault-read)
      // delegation. Any other template is site-login only.
      const payExtra = enroll.delegationTemplate === "x402-pay" ? await runPayment() : undefined;
      setStatus("Finishing…");
      const code = await submitEnrollGrant(grant_id, wire, payExtra);
      clearPendingEnroll();
      setStatus("Returning to the app…");
      deliverEnrollCode(enroll, code); // navigates away
    } catch (e) {
      ran.current = false;
      setStatus("");
      const msg = e instanceof Error ? e.message : String(e);
      if (SESSION_STALE.test(msg)) {
        // Stale token — drop to a fresh connect (keeps the request stashed so a social
        // reconnect resumes automatically on return).
        stashPendingEnroll(enroll);
        setError("Your home session expired — reconnect to authorize.");
        signOut();
      } else {
        setError(msg);
      }
    }
  }

  // Auto-run when the reader connected DURING this ceremony (justConnected) — including the social
  // round-trip resume. A plain restored session requires an explicit Approve click below.
  useEffect(() => {
    if (phase === "authed" && identity && justConnected) void authorize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, identity, justConnected]);

  function pick(via: Via) {
    setError("");
    // Social redirects the whole page out → stash the request so we can resume on return.
    if (via === "google" || via === "youversion") stashPendingEnroll(enroll);
    void signIn(via, enroll.name || undefined);
  }

  function deny() {
    clearPendingEnroll();
    deliverEnrollError(enroll, "access_denied");
  }

  // "Not you?" — the home may hold a RESTORED session for a different custodian (you disconnected in
  // the relying app, not here). Sign out of the home and drop to the credential picker so you can
  // authorize as someone else, WITHOUT bouncing back to the app with an error.
  function switchAccount() {
    setError("");
    ran.current = false;
    clearPendingEnroll();
    signOut();
  }

  const connected = phase === "authed" && identity;

  return (
    <div className="entry">
      <div style={{ maxWidth: 420, margin: "0 auto", textAlign: "center" }}>
        <h2 style={{ marginBottom: 4 }}>Authorize an app</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          <b>{enroll.clientId}</b> wants to sign you in and read your profile from your vault via your
          Global.Church home. The app never sees your credential — you sign the authorization yourself.
        </p>

        {error && <div style={{ color: "#c0392b", fontSize: 13, margin: "8px 0" }}>{error}</div>}

        {phase === "restoring" && <div className="muted">Checking your session…</div>}

        {phase !== "restoring" && !connected && (
          <div>
            <p className="muted" style={{ marginBottom: 8 }}>Continue with your home credential:</p>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
              {CREDENTIALS.map((c) => (
                <button key={c.via} className="ap" onClick={() => pick(c.via)}>{c.label}</button>
              ))}
            </div>
          </div>
        )}

        {connected && (
          <div>
            {status || justConnected ? (
              <div className="muted">{status || "Authorizing…"}</div>
            ) : (
              <>
                {error ? (
                  <>
                    <button className="ap" onClick={() => { ran.current = false; void authorize(); }}>Try again</button>{" "}
                    <button className="ap" onClick={deny}>Cancel</button>
                  </>
                ) : (
                  <>
                    <p className="muted" style={{ margin: "8px 0" }}>
                      Connected as <b>{identity.name ?? identity.address.slice(0, 10) + "…"}</b>.
                    </p>
                    <button className="ap" onClick={() => void authorize()}>Approve</button>{" "}
                    <button className="ap" onClick={deny}>Deny</button>
                  </>
                )}
                <div style={{ marginTop: 10 }}>
                  <button
                    onClick={switchAccount}
                    style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontSize: 12, textDecoration: "underline" }}
                  >
                    Not you? Use a different account
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
