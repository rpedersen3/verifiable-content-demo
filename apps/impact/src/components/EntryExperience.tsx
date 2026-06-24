"use client";

import { useState } from "react";
import { useSession, type Via } from "@/context/session";
import { brand, credentialMethods, copy } from "@/whitelabel/config";
import { IconKey, IconCheck, IconShield } from "@/components/Icons";

// The redesigned arrival screen. All four entry methods (passkey / Google /
// YouVersion / wallet) are presented; phase 1 resolves any of them to the seeded
// member. The real ceremonies bind in behind useSession().signIn.
export default function EntryExperience() {
  const { signIn } = useSession();
  const [busy, setBusy] = useState<Via | null>(null);

  function enter(via: Via) {
    setBusy(via);
    // brief beat so the affordance reads as a real ceremony
    setTimeout(() => signIn(via), 420);
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
        <p className="muted" style={{ marginBottom: "1.5rem" }}>
          {copy.enterSub.replace("{community}", brand.community)}
        </p>

        <div className="col" style={{ gap: ".7rem" }}>
          {credentialMethods.map((m) => (
            <button
              key={m.via}
              className="method-btn"
              onClick={() => enter(m.via)}
              disabled={busy !== null}
            >
              <span
                className="glyph glyph-sm"
                style={{
                  background:
                    m.via === "passkey"
                      ? "var(--grad-amber)"
                      : m.via === "wallet"
                        ? "var(--grad-plum)"
                        : "var(--surface-inset)",
                  color: m.via === "wallet" ? "#fff" : "#1c1917",
                }}
              >
                {busy === m.via ? <IconCheck width={16} height={16} /> : <IconKey width={15} height={15} />}
              </span>
              <span className="col" style={{ gap: 1 }}>
                <span>{busy === m.via ? "Opening your home…" : m.label}</span>
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
