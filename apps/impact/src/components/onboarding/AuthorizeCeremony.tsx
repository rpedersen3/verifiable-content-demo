"use client";

// Relying-app OIDC authorize ceremony (spec 230) — the home SPA view shown when the browser
// lands on `/?client_id=…`. Ensures the reader is connected, then mints a site-login delegation
// (person SA → the registry delegate) signed with their OWN credential — the home holds no key —
// and redirects back to the relying app with an auth code.
import { useEffect, useRef, useState } from "react";
import { useSession, type Via } from "@/context/session";
import type { Address } from "@/lib/types";
import { secureSocialHome } from "@/lib/vault-key";
import { createPersonTreasury, signHashForVia, enrollRecoveryPasskey } from "@/lib/connect";
import { recallRecoveryHome } from "@/lib/passkey";
import { buildUnsignedPaymentDelegation, OPEN_DELEGATION, toWire, type DelegationWire } from "@/lib/delegation";
import { getClient, getClientPaymentConfig, getClientContentSignerConfig } from "@/lib/oidc-clients";
import { chargePayment } from "@/lib/pay";
import { CONTRACTS } from "@/lib/chain";
import {
  beginEnrollmentGrant,
  submitEnrollGrant,
  deliverEnrollCode,
  deliverEnrollError,
  issueSiteDelegation,
  issuePaymentDelegation,
  authorizeContentSigningForOwner,
  deliverCollectResult,
  stashPendingEnroll,
  clearPendingEnroll,
  type EnrollReq,
} from "@/lib/enroll";

// Social-first: the default way in is your social source. Passkey/wallet are offered as secondary
// "more ways" so most members never touch a wallet or manage a passkey to get started.
const SOCIAL: { via: Via; label: string; hint: string }[] = [
  { via: "google", label: "Continue with Google", hint: "We derive your agent — no password to manage" },
  { via: "youversion", label: "Continue with YouVersion", hint: "Bring your Bible app identity" },
];
const SECONDARY: { via: Via; label: string }[] = [
  { via: "passkey", label: "Passkey" },
  { via: "wallet", label: "Wallet" },
];

// A signing failure caused by a stale/expired custody session — the reader must reconnect for a
// fresh AgentSession token (a restored localStorage session can hold an expired token).
const SESSION_STALE = /expired|invalid session|custody session|sign in again|no live custody/i;

export default function AuthorizeCeremony({ enroll }: { enroll: EnrollReq }) {
  const { phase, identity, token, signIn, signOut, markDeployed, justConnected } = useSession();
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  // Optional naming (opt-in, never the default): most members stay nameless and can claim a public
  // name later. Only surfaced when they open "Name your agent".
  const [nameInput, setNameInput] = useState("");
  const [showName, setShowName] = useState(false);
  // Recovery-passkey offer: once the auth code is minted we hold it here and offer to add a fast
  // passkey BEFORE redirecting back. Skipping (or adding) delivers the code.
  const [offer, setOffer] = useState<{ code: string } | null>(null);
  const [busy, setBusy] = useState<Via | null>(null);
  const ran = useRef(false);

  // Offer a fast passkey to social/wallet homes that don't already recover to a passkey on THIS
  // device. Passkey homes already have one; a home we've already enrolled here is skipped.
  function shouldOfferPasskey(): boolean {
    if (!identity) return false;
    if (identity.via === "passkey") return false;
    return recallRecoveryHome() !== (identity.address as Address);
  }

  function returnToApp(code: string) {
    clearPendingEnroll();
    setStatus("Returning to the app…");
    deliverEnrollCode(enroll, code); // navigates away
  }

  async function addRecoveryPasskey(code: string) {
    if (!identity) return;
    setError("");
    const res = await enrollRecoveryPasskey(identity.address as Address, identity.via, token ?? undefined, setStatus);
    if (!res.ok) {
      // Best-effort: the authorization already succeeded — surface the reason but let them retry or
      // skip. We keep the code so either path still returns them to the app.
      setStatus("");
      setError(`Couldn't add the passkey: ${res.error}`);
      return;
    }
    returnToApp(code);
  }

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
      // content-signer (spec 266) is an OWNER-OP: no home-deploy, no site-login grant. The owner signs
      // the issuer→KMS-key leaf(s) and the content service stores them; then redirect back with the result.
      if (enroll.delegationTemplate === "content-signer") {
        const csClient = getClient(enroll.clientId);
        const cs = csClient ? getClientContentSignerConfig(csClient) : null;
        if (!cs) throw new Error("This app isn't configured for content-signer authorization.");
        if (!enroll.collectToken) throw new Error("Missing owner token for content-signer authorization.");
        setStatus("Authorizing content signing…");
        const res = await authorizeContentSigningForOwner(identity.via, token ?? undefined, {
          a2aBase: cs.a2aBase,
          idToken: enroll.collectToken,
          targetSigner: enroll.contentSignerTarget,
        });
        if (!res.ok) throw new Error(res.error);
        clearPendingEnroll();
        setStatus("Returning…");
        deliverCollectResult(enroll, { authorized: res.authorized, attempted: res.attempted }, "content-signer");
        return; // navigates away
      }
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
      // Before redirecting back, offer a fast recovery passkey (skippable). Passkey/already-enrolled
      // homes skip straight through.
      if (shouldOfferPasskey()) { setStatus(""); setOffer({ code }); return; }
      returnToApp(code);
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

  async function pick(via: Via) {
    setError("");
    // Optional name (opt-in) overrides the request's agent_name hint; empty ⇒ nameless home.
    const nameHint = nameInput.trim() || enroll.name || undefined;
    // Social redirects the whole page out → stash the request so we can resume on return.
    if (via === "google" || via === "youversion") stashPendingEnroll(enroll);
    setBusy(via);
    const err = await signIn(via, nameHint, setStatus); // social never resolves (page navigates)
    if (err) { setError(err); setBusy(null); setStatus(""); }
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

        {/* Recovery-passkey offer — shown after the auth code is minted, before redirecting back. */}
        {offer && (
          <div style={{ textAlign: "left", marginTop: 8 }}>
            {status ? (
              <div className="muted" style={{ textAlign: "center" }}>{status}</div>
            ) : (
              <>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Add a fast passkey to this device?</div>
                <p className="muted" style={{ marginTop: 0 }}>
                  Next time you can open your home with one tap — no {viaLabel(identity?.via)} redirect. Your
                  {" "}{viaLabel(identity?.via)} sign-in keeps working too.
                </p>
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button className="ap" onClick={() => void addRecoveryPasskey(offer.code)}>Add passkey</button>
                  <button
                    onClick={() => returnToApp(offer.code)}
                    style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontSize: 13, textDecoration: "underline" }}
                  >
                    Skip for now
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {!offer && phase !== "restoring" && !connected && (
          <div style={{ textAlign: "left" }}>
            <p className="muted" style={{ marginBottom: 10, textAlign: "center" }}>Choose how to sign in:</p>
            {/* Primary: social */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {SOCIAL.map((c) => (
                <button
                  key={c.via}
                  className="ap"
                  style={{ width: "100%", textAlign: "left", padding: "10px 14px", opacity: busy && busy !== c.via ? 0.5 : 1 }}
                  disabled={busy !== null}
                  onClick={() => void pick(c.via)}
                >
                  <span style={{ fontWeight: 600 }}>{busy === c.via ? (status || "Redirecting…") : c.label}</span>
                  {busy !== c.via && <span className="muted" style={{ display: "block", fontSize: 12 }}>{c.hint}</span>}
                </button>
              ))}
            </div>

            {/* Optional naming — opt-in, never the default */}
            <div style={{ marginTop: 10 }}>
              {!showName ? (
                <button
                  onClick={() => setShowName(true)}
                  disabled={busy !== null}
                  style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontSize: 12, textDecoration: "underline" }}
                >
                  Name your agent (optional)
                </button>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    placeholder="grace"
                    disabled={busy !== null}
                    autoFocus
                    style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: "1px solid #d4d4d8", fontSize: 14 }}
                  />
                  <span className="muted" style={{ fontSize: 13 }}>.impact</span>
                </div>
              )}
              <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                Optional — you can stay nameless and claim a public name anytime later.
              </p>
            </div>

            {/* Secondary: passkey / wallet */}
            <div style={{ marginTop: 12 }}>
              <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>More ways to connect</div>
              <div style={{ display: "flex", gap: 8 }}>
                {SECONDARY.map((c) => (
                  <button
                    key={c.via}
                    className="ap"
                    style={{ flex: 1, opacity: busy && busy !== c.via ? 0.5 : 1 }}
                    disabled={busy !== null}
                    onClick={() => void pick(c.via)}
                  >
                    {busy === c.via ? (status || "Working…") : c.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {!offer && connected && (
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

function viaLabel(via?: Via): string {
  switch (via) {
    case "google": return "Google";
    case "youversion": return "YouVersion";
    case "wallet": return "wallet";
    case "passkey": return "passkey";
    default: return "sign-in";
  }
}
