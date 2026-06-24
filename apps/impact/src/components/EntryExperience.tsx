"use client";

import { useState } from "react";
import { useSession, type Via } from "@/context/session";
import { brand, credentialMethods, copy } from "@/whitelabel/config";
import { IconKey, IconShield } from "@/components/Icons";

// Real arrival: passkey + wallet run the live WebAuthn / SIWE ceremony against the
// deployed demo-a2a relayer and produce a real Smart Agent. Google/YouVersion return
// a "needs configuration" message until their OAuth + custody-bridge env is set.
export default function EntryExperience() {
  const { signIn } = useSession();
  const [busy, setBusy] = useState<Via | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<string | null>(null);

  async function enter(via: Via) {
    setBusy(via);
    setError(null);
    setStep(via === "passkey" ? "Touch your authenticator…" : via === "wallet" ? "Confirm in your wallet…" : "Redirecting…");
    const err = await signIn(via, name.trim() || undefined);
    if (err) {
      setError(err);
      setBusy(null);
      setStep(null);
    }
    // on success the landing gate redirects to /home
  }

  return (
    <div className="entry">
      <div className="entry-card anim-in">
        <div className="row" style={{ gap: ".7rem", marginBottom: "1.4rem" }}>
          <div className="glyph glyph-md" style={{ background: "var(--grad-amber)", color: "#1c1917" }}>
            <IconShield width={24} height={24} />
          </div>
          <div>
            <div className="h2" style={{ fontWeight: 800 }}>{brand.name}</div>
            <div className="muted" style={{ fontSize: ".82rem" }}>your agent home</div>
          </div>
        </div>

        <h1 className="h1" style={{ marginBottom: ".4rem" }}>{copy.enterTitle}</h1>
        <p className="muted" style={{ marginBottom: "1.3rem" }}>
          {copy.enterSub.replace("{community}", brand.community)}
        </p>

        <label className="faint" style={{ fontSize: ".74rem", fontWeight: 600 }}>
          Choose your name <span style={{ fontWeight: 400 }}>(new home only — returning members sign straight in)</span>
        </label>
        <div className="row" style={{ gap: ".4rem", margin: ".35rem 0 1.1rem" }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="grace"
            disabled={busy !== null}
            style={{
              flex: 1, padding: ".6rem .8rem", borderRadius: "var(--r-md)",
              border: "1px solid var(--border-strong)", background: "var(--surface-raised)",
              fontSize: ".92rem", color: "var(--ink)",
            }}
          />
          <span className="addr">.impact</span>
        </div>

        {error && (
          <div className="card-pad chip-danger" style={{ borderRadius: "var(--r-md)", marginBottom: "1rem", fontSize: ".82rem" }}>
            {error}
          </div>
        )}

        <div className="col" style={{ gap: ".7rem" }}>
          {credentialMethods.map((m) => (
            <button key={m.via} className="method-btn" onClick={() => enter(m.via)} disabled={busy !== null}>
              <span
                className="glyph glyph-sm"
                style={{
                  background: m.via === "passkey" ? "var(--grad-amber)" : m.via === "wallet" ? "var(--grad-plum)" : "var(--surface-inset)",
                  color: m.via === "wallet" ? "#fff" : "#1c1917",
                }}
              >
                <IconKey width={15} height={15} />
              </span>
              <span className="col" style={{ gap: 1 }}>
                <span>{busy === m.via ? (step ?? "Working…") : m.label}</span>
                <span className="faint" style={{ fontSize: ".74rem", fontWeight: 500 }}>{m.hint}</span>
              </span>
            </button>
          ))}
        </div>

        <p className="faint" style={{ fontSize: ".74rem", marginTop: "1.4rem", textAlign: "center" }}>
          You own this home. We never hold your keys — every action is yours to authorize.
        </p>
      </div>
    </div>
  );
}
