"use client";

import { useEffect, useRef, useState } from "react";
import { useSession, type Via } from "@/context/session";
import { brand, credentialMethods, copy } from "@/whitelabel/config";
import { IconKey, IconShield, IconCheck } from "@/components/Icons";
import { currentHandle, homeOrigin } from "@/lib/domain";

interface NameInfo {
  exists: boolean;
  name?: string;
  deployed?: boolean;
  hasEoa?: boolean;
  hasPasskey?: boolean;
}
type Mode = "nameless" | "named";
type Lookup =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "free"; name: string }
  | { status: "exists"; name: string; vias: Via[] }
  | { status: "orphan"; name: string }
  | { status: "error" };

// Arrival. You choose a NAMELESS home (default — claim a public name later) or a NAMED
// home. In named mode the name resolves live against the agent naming service and adapts:
// a free name → secure a new home; an existing home → open it with the credential(s) it
// was registered with. Passkey + wallet run the real ceremony; Google/YouVersion redirect.
export default function EntryExperience() {
  const { signIn } = useSession();
  const [mode, setMode] = useState<Mode>("nameless");
  const [busy, setBusy] = useState<Via | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [lookup, setLookup] = useState<Lookup>({ status: "idle" });
  const seq = useRef(0);

  // On a personal subdomain (lbsb.<domain>) we ARE that named home: force named mode +
  // prefill the handle so the connect runs here, on the domain the passkey is bound to.
  useEffect(() => {
    const h = currentHandle();
    if (h) { setMode("named"); setName(h); }
  }, []);

  // A social sign-in that VERIFIED but found no home returns ?connect_status=bootstrap.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("connect_status") === "bootstrap") {
      const email = p.get("email") || "your account";
      const v = p.get("via");
      const provider = v === "youversion" ? "YouVersion" : v === "google" ? "Google" : "Your provider";
      setError(
        `${provider} verified ${email}, but there's no home for it yet. Creating a new home from a social sign-in needs the server custody bridge configured (A2A_CUSTODY_BRIDGE_SECRET matching your impact-a2a). Once set, this signs you straight in.`,
      );
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const onHandle = currentHandle();
  const isNamed = mode === "named";
  // While a passkey/wallet ceremony runs we show the guided value-step securing view.
  // (Social redirects the whole page out, so there's nothing to show inline.)
  const securing = busy === "passkey" || busy === "wallet";

  // Debounced live name resolution — only in named mode.
  useEffect(() => {
    if (mode !== "named") { setLookup({ status: "idle" }); return; }
    const base = name.trim().toLowerCase().replace(/\.(impact)$/, "");
    if (!base) { setLookup({ status: "idle" }); return; }
    const id = ++seq.current;
    setLookup({ status: "checking" });
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/connect/name-info?name=${encodeURIComponent(base)}`);
        const info = (await r.json()) as NameInfo;
        if (id !== seq.current) return;
        const full = `${base}.impact`;
        if (!info.exists) { setLookup({ status: "free", name: full }); return; }
        if (info.exists && info.deployed === false) { setLookup({ status: "orphan", name: full }); return; }
        const vias: Via[] = [];
        if (info.hasPasskey) vias.push("passkey");
        if (info.hasEoa) vias.push("wallet");
        setLookup({ status: "exists", name: full, vias: vias.length ? vias : ["passkey", "wallet"] });
      } catch {
        if (id === seq.current) setLookup({ status: "error" });
      }
    }, 400);
    return () => clearTimeout(t);
  }, [name, mode]);

  const isOpen = isNamed && lookup.status === "exists";
  const shown = isOpen
    ? credentialMethods.filter((m) => (lookup as { vias: Via[] }).vias.includes(m.via))
    : credentialMethods;
  // Social-first: social is the primary way in; passkey/wallet are offered as secondary "more ways".
  const socialShown = shown.filter((m) => m.via === "google" || m.via === "youversion");
  const secondaryShown = shown.filter((m) => m.via === "passkey" || m.via === "wallet");

  async function enter(via: Via) {
    const label = isNamed ? name.trim().toLowerCase().replace(/\.impact$/, "").replace(/[^a-z0-9-]/g, "") : "";
    // A NAMED home lives on its OWN subdomain (`<label>.<domain>`) — switch there before connecting,
    // for EVERY credential, not just passkey. Passkey additionally REQUIRES it (the SA address bakes
    // in the host's rpIdHash); wallet/social work on the apex too, but the home is expected to open on
    // its per-handle origin (its own SSO scope). Skip only when we're already on that handle's subdomain.
    if (label && onHandle !== label) {
      setBusy(via);
      setStep(`Switching to ${label}’s home…`);
      window.location.href = `${homeOrigin(label)}/`;
      return;
    }
    setBusy(via);
    setError(null);
    setStep(via === "passkey" ? "Starting…" : via === "wallet" ? "Connecting your wallet…" : "Redirecting…");
    const nameHint = isNamed ? name.trim() || undefined : undefined;
    const err = await signIn(via, nameHint, (s) => setStep(s));
    if (err) { setError(err); setBusy(null); setStep(null); }
  }

  const renderMethod = (m: { via: Via; label: string; hint: string }) => (
    <button key={m.via} className="method-btn" onClick={() => enter(m.via)} disabled={busy !== null}>
      <span
        className="glyph glyph-sm"
        style={{
          background: m.via === "passkey" ? "var(--grad-amber)" : m.via === "wallet" ? "var(--grad-plum)" : "var(--surface-inset)",
          color: m.via === "wallet" ? "#fff" : "#1c1917",
        }}
      >
        {busy === m.via ? <span className="spin" aria-hidden /> : <IconKey width={15} height={15} />}
      </span>
      <span className="col" style={{ gap: 1, minWidth: 0 }}>
        <span>{isOpen ? openLabel(m.via) : m.label}</span>
        <span className="faint" style={{ fontSize: ".74rem", fontWeight: 500 }}>
          {busy === m.via ? (step ?? "Working…") : m.hint}
        </span>
      </span>
    </button>
  );

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

        <h1 className="h1" style={{ marginBottom: ".4rem" }}>
          {isOpen ? "Welcome back" : copy.enterTitle}
        </h1>
        <p className="muted" style={{ marginBottom: "1.2rem" }}>
          {isOpen
            ? "This home is already registered — open it with your credential below."
            : copy.enterSub.replace("{community}", brand.community)}
        </p>

        {securing ? (
          <SecuringView mode={mode} name={name} step={step} />
        ) : (
        <>
        {/* Named vs nameless choice */}
        <div className="eyebrow" style={{ marginBottom: ".4rem" }}>Your agent</div>
        <div className="row" style={{ gap: ".5rem", marginBottom: isNamed ? ".5rem" : "1.1rem" }}>
          <button
            className={`btn btn-sm ${!isNamed ? "btn-primary" : "btn-ghost"}`}
            style={{ flex: 1 }}
            disabled={busy !== null || !!onHandle}
            onClick={() => setMode("nameless")}
          >
            Nameless
          </button>
          <button
            className={`btn btn-sm ${isNamed ? "btn-primary" : "btn-ghost"}`}
            style={{ flex: 1 }}
            disabled={busy !== null}
            onClick={() => setMode("named")}
          >
            Choose a name
          </button>
        </div>

        {!isNamed && (
          <p className="faint" style={{ fontSize: ".78rem", marginBottom: "1.1rem" }}>
            We&apos;ll secure a nameless home — fully yours. You can claim a public name anytime later.
          </p>
        )}

        {isNamed && (
          <>
            <div className="row" style={{ gap: ".4rem", margin: ".25rem 0 .5rem" }}>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="grace"
                disabled={busy !== null || !!onHandle}
                autoFocus
                style={{
                  flex: 1, padding: ".6rem .8rem", borderRadius: "var(--r-md)",
                  border: "1px solid var(--border-strong)", background: "var(--surface-raised)",
                  fontSize: ".92rem", color: "var(--ink)",
                }}
              />
              <span className="addr">.impact</span>
            </div>
            <div style={{ minHeight: 22, marginBottom: ".9rem", fontSize: ".78rem" }}>
              {lookup.status === "checking" && <span className="faint">Checking the naming service…</span>}
              {lookup.status === "free" && (
                <span style={{ color: "var(--emerald-700)" }}>
                  <IconCheck width={13} height={13} style={{ verticalAlign: "-2px" }} /> {lookup.name} is available — secure it as your new home.
                </span>
              )}
              {lookup.status === "exists" && (
                <span className="muted">{lookup.name} is registered — opens with <strong>{lookup.vias.join(" or ")}</strong>.</span>
              )}
              {lookup.status === "orphan" && (
                <span style={{ color: "var(--amber-700)" }}>{lookup.name} has an incomplete previous setup — try again or pick another name.</span>
              )}
              {lookup.status === "error" && <span className="faint">Couldn’t reach the naming service — you can still proceed.</span>}
            </div>
          </>
        )}

        {error && (
          <div className="card-pad chip-danger" style={{ borderRadius: "var(--r-md)", marginBottom: "1rem", fontSize: ".82rem" }}>
            {error}
          </div>
        )}

        <div className="col" style={{ gap: ".7rem" }}>
          {/* Primary: social (or, when only passkey/wallet are available for an existing home, those). */}
          {(socialShown.length ? socialShown : secondaryShown).map(renderMethod)}
        </div>
        {socialShown.length > 0 && secondaryShown.length > 0 && (
          <>
            <div className="eyebrow" style={{ margin: "1rem 0 .4rem" }}>More ways to connect</div>
            <div className="col" style={{ gap: ".7rem" }}>
              {secondaryShown.map(renderMethod)}
            </div>
          </>
        )}
        </>
        )}

        <p className="faint" style={{ fontSize: ".74rem", marginTop: "1.4rem", textAlign: "center" }}>
          You own this home. We never hold your keys — every action is yours to authorize.
        </p>
      </div>
    </div>
  );
}

// The guided "secure → register → sign-in" value steps shown while the ceremony runs
// (ported from impact OnboardingJourney's ValueStepList).
function SecuringView({ mode, name, step }: { mode: Mode; name: string; step: string | null }) {
  const named = mode === "named";
  const base = name.trim().toLowerCase().replace(/\.impact$/, "").replace(/[^a-z0-9-]/g, "") || "your-home";
  const steps = [
    { title: "Secure your home", body: "Your agent, deployed on-chain — only you can open it." },
    named
      ? { title: `Register ${base}.impact`, body: "Claim your name in the community registry." }
      : { title: "Stay nameless", body: "A home you can name later, by choice." },
    { title: "Sign you in", body: "A short-lived session, signed by your key." },
  ];
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: ".2rem" }}>Securing your home</div>
      <p className="faint" style={{ fontSize: ".78rem", marginBottom: "1rem" }}>One credential interaction does it all.</p>
      <div className="col" style={{ gap: ".8rem", marginBottom: "1.1rem" }}>
        {steps.map((s, i) => (
          <div key={i} className="row" style={{ gap: ".7rem", alignItems: "flex-start" }}>
            <span
              className="glyph glyph-sm"
              style={{ background: "var(--surface-sunken)", color: "var(--amber-700)", fontSize: ".82rem" }}
              aria-hidden
            >
              {i + 1}
            </span>
            <div className="col" style={{ gap: 0 }}>
              <strong style={{ fontSize: ".9rem" }}>{s.title}</strong>
              <span className="muted" style={{ fontSize: ".8rem" }}>{s.body}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="card card-pad row" style={{ gap: ".6rem" }}>
        <span className="spin" aria-hidden />
        <span className="muted" style={{ fontSize: ".86rem" }}>{step ?? "Working…"}</span>
      </div>
    </div>
  );
}

function openLabel(via: Via): string {
  switch (via) {
    case "passkey": return "Open with your passkey";
    case "wallet": return "Open with your wallet";
    case "google": return "Open with Google";
    case "youversion": return "Open with YouVersion";
  }
}
