"use client";

// The onboarding REWARD beat (ported from impact HomeResolvedView): shown right
// after a connect THIS session. A brand-new home → "You're in"; a reconnect → "Welcome
// back". A restored session (page reload) skips this entirely (gate gates on justConnected).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/context/session";
import { nameLabel } from "@/lib/domain";
import { IconCheck, IconShield, IconKey } from "@/components/Icons";
import { Glyph } from "@/components/ui";
import { enrollRecoveryPasskey } from "@/lib/connect";
import { recallRecoveryHome } from "@/lib/passkey";
import type { Address } from "@/lib/types";

export default function HomeResolvedView() {
  const { identity, token, justConnected, clearJustConnected } = useSession();
  const router = useRouter();
  const fresh = justConnected?.fresh ?? true;
  const named = !!identity?.name;
  const label = identity?.name ? nameLabel(identity.name) : null;

  // Offer a fast recovery passkey to a social/wallet home that's deployed and not already enrolled
  // on THIS device. addPasskey is a post-deploy self-call, so a counterfactual home is skipped.
  const canOfferPasskey =
    !!identity && identity.deployed && identity.via !== "passkey" && recallRecoveryHome() !== (identity.address as Address);
  const [pkState, setPkState] = useState<"idle" | "working" | "done" | "skipped">("idle");
  const [pkStatus, setPkStatus] = useState("");
  const [pkErr, setPkErr] = useState("");

  async function addPasskey() {
    if (!identity) return;
    setPkErr("");
    setPkState("working");
    const res = await enrollRecoveryPasskey(identity.address as Address, identity.via, token ?? undefined, setPkStatus);
    if (!res.ok) { setPkState("idle"); setPkErr(res.error); return; }
    setPkState("done");
  }

  function enter() {
    clearJustConnected();
    router.push("/home");
  }

  return (
    <div className="entry">
      <div className="entry-card anim-in" style={{ textAlign: "center" }}>
        <div
          className="glyph glyph-lg"
          style={{ margin: "0 auto 1.2rem", background: "var(--grad-emerald)", width: 64, height: 64 }}
          aria-hidden
        >
          <IconCheck width={30} height={30} />
        </div>

        <h1 className="h1" style={{ marginBottom: ".5rem" }}>
          {fresh ? "Your home is secured" : `Welcome back${label ? `, ${label}` : ""}`}
        </h1>
        <p className="muted" style={{ marginBottom: "1.4rem", maxWidth: 380, marginInline: "auto" }}>
          {fresh
            ? named
              ? `You're registered as ${label}. Only you can open this home — it's yours.`
              : "Your nameless home is ready — fully yours. You can claim a public name anytime."
            : "Good to see you again. Everything is just as you left it."}
        </p>

        <div className="card card-pad row" style={{ gap: ".7rem", justifyContent: "center", marginBottom: "1.4rem" }}>
          {identity && <Glyph kind="person" name={label ?? "You"} size="md" />}
          <div className="col" style={{ gap: 1, textAlign: "left" }}>
            <strong style={{ fontSize: ".92rem" }}>{label ? `${label}.impact` : "Your agent"}</strong>
            {identity && (
              <span className="faint" style={{ fontSize: ".74rem" }}>
                {identity.address.slice(0, 10)}…{identity.address.slice(-6)}
                {!identity.deployed ? " · counterfactual" : ""}
              </span>
            )}
          </div>
        </div>

        {fresh && (
          <div className="col" style={{ gap: ".55rem", marginBottom: "1.4rem", textAlign: "left" }}>
            <Receipt>Your home is secured — only you can open it</Receipt>
            {named ? <Receipt>You&apos;re registered as {label}</Receipt> : <Receipt>Nameless for now — claim a public name anytime</Receipt>}
          </div>
        )}

        {canOfferPasskey && pkState !== "skipped" && (
          <div className="card card-pad col" style={{ gap: ".55rem", marginBottom: "1.1rem", textAlign: "left" }}>
            {pkState === "done" ? (
              <div className="row" style={{ gap: ".5rem" }}>
                <span className="chip chip-emerald" style={{ padding: ".15rem .35rem" }}><IconCheck width={12} height={12} /></span>
                <span className="muted" style={{ fontSize: ".84rem" }}>Fast passkey added — next time, open your home with one tap.</span>
              </div>
            ) : (
              <>
                <div className="row" style={{ gap: ".5rem", alignItems: "center" }}>
                  <span className="glyph glyph-sm" style={{ background: "var(--grad-amber)", color: "#1c1917" }}><IconKey width={14} height={14} /></span>
                  <strong style={{ fontSize: ".9rem" }}>Add a fast passkey to this device</strong>
                </div>
                <span className="muted" style={{ fontSize: ".82rem" }}>
                  {pkState === "working"
                    ? (pkStatus || "Working…")
                    : "Next time, open your home with one tap — no redirect. Your current sign-in keeps working."}
                </span>
                {pkErr && <span style={{ color: "var(--rose-700, #c0392b)", fontSize: ".78rem" }}>Couldn’t add the passkey: {pkErr}</span>}
                {pkState !== "working" && (
                  <div className="row" style={{ gap: ".5rem", marginTop: ".2rem" }}>
                    <button className="btn btn-sm btn-primary" onClick={() => void addPasskey()}>Add passkey</button>
                    <button className="btn btn-sm btn-ghost" onClick={() => setPkState("skipped")}>Not now</button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <button className="btn btn-primary" style={{ width: "100%" }} onClick={enter}>
          Enter your home
        </button>
      </div>
    </div>
  );
}

function Receipt({ children }: { children: React.ReactNode }) {
  return (
    <div className="row" style={{ gap: ".5rem", fontSize: ".84rem" }}>
      <span className="chip chip-emerald" style={{ padding: ".15rem .35rem" }}><IconShield width={12} height={12} /></span>
      <span className="muted">{children}</span>
    </div>
  );
}
