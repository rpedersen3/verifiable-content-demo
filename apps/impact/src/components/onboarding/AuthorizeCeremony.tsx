"use client";

// Relying-app OIDC authorize ceremony (spec 230) — the home SPA view shown when the browser
// lands on `/?client_id=…`. Ensures the reader is connected, then mints a site-login delegation
// (person SA → the registry delegate) signed with their OWN credential — the home holds no key —
// and redirects back to the relying app with an auth code.
import { useEffect, useRef, useState } from "react";
import { useSession, type Via } from "@/context/session";
import type { Address } from "@/lib/types";
import {
  beginEnrollmentGrant,
  submitEnrollGrant,
  deliverEnrollCode,
  deliverEnrollError,
  issueSiteDelegation,
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

export default function AuthorizeCeremony({ enroll }: { enroll: EnrollReq }) {
  const { phase, identity, token, signIn, justConnected } = useSession();
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const ran = useRef(false);

  async function authorize() {
    if (ran.current) return;
    ran.current = true;
    setError("");
    try {
      if (!identity) throw new Error("not connected");
      if (!identity.deployed) {
        throw new Error("Your home isn't deployed on-chain yet — open your home once, then retry.");
      }
      setStatus("Requesting authorization…");
      const { grant_id, delegate } = await beginEnrollmentGrant(enroll, identity.name ?? "");
      setStatus("Sign to authorize this app to read your vault…");
      const wire = await issueSiteDelegation(identity.address as Address, delegate, identity.via, token ?? undefined);
      setStatus("Finishing…");
      const code = await submitEnrollGrant(grant_id, wire);
      clearPendingEnroll();
      setStatus("Returning to the app…");
      deliverEnrollCode(enroll, code); // navigates away
    } catch (e) {
      ran.current = false;
      setError(e instanceof Error ? e.message : String(e));
      setStatus("");
    }
  }

  // Auto-run when the reader connected DURING this ceremony (justConnected) — including the social
  // round-trip resume. A plain restored session requires an explicit Approve click below.
  useEffect(() => {
    if (phase === "authed" && identity && justConnected) void authorize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, identity, justConnected]);

  function pick(via: Via) {
    // Social redirects the whole page out → stash the request so we can resume on return.
    if (via === "google" || via === "youversion") stashPendingEnroll(enroll);
    void signIn(via, enroll.name || undefined);
  }

  function deny() {
    clearPendingEnroll();
    deliverEnrollError(enroll, "access_denied");
  }

  return (
    <div className="entry">
      <div style={{ maxWidth: 420, margin: "0 auto", textAlign: "center" }}>
        <h2 style={{ marginBottom: 4 }}>Authorize an app</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          <b>{enroll.clientId}</b> wants to sign you in and read your profile from your vault via your
          Global.Church home. The app never sees your credential — you sign the authorization yourself.
        </p>

        {phase === "restoring" && <div className="muted">Checking your session…</div>}

        {phase !== "restoring" && (phase !== "authed" || !identity) && (
          <div>
            <p className="muted" style={{ marginBottom: 8 }}>Continue with your home credential:</p>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
              {CREDENTIALS.map((c) => (
                <button key={c.via} className="ap" onClick={() => pick(c.via)}>{c.label}</button>
              ))}
            </div>
          </div>
        )}

        {phase === "authed" && identity && (
          <div>
            {error ? (
              <>
                <div style={{ color: "#c0392b", fontSize: 13, margin: "8px 0" }}>{error}</div>
                <button className="ap" onClick={() => { ran.current = false; void authorize(); }}>Try again</button>{" "}
                <button className="ap" onClick={deny}>Cancel</button>
              </>
            ) : status || justConnected ? (
              <div className="muted">{status || "Authorizing…"}</div>
            ) : (
              <>
                <p className="muted" style={{ margin: "8px 0" }}>
                  Connected as <b>{identity.name ?? identity.address.slice(0, 10) + "…"}</b>.
                </p>
                <button className="ap" onClick={() => void authorize()}>Approve</button>{" "}
                <button className="ap" onClick={deny}>Deny</button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
