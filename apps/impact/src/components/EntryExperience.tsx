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
type Lookup =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "free"; name: string }
  | { status: "exists"; name: string; vias: Via[] }
  | { status: "orphan"; name: string }
  | { status: "error" };

// Real arrival. As you type a name, it resolves against the agent NAMING SERVICE
// (live, via /connect/name-info) and ADAPTS: a free name → secure a new home with any
// credential; an existing home → open it with only the credential(s) it was registered
// with (derived from the agent's on-chain custodian set). Passkey + wallet run the real
// ceremony; Google/YouVersion report "needs configuration" until their env is set.
export default function EntryExperience() {
  const { signIn } = useSession();
  const [busy, setBusy] = useState<Via | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [lookup, setLookup] = useState<Lookup>({ status: "idle" });
  const seq = useRef(0);

  // If we're already on a personal subdomain (lbsb.<domain>), this home IS that handle —
  // prefill it so the connect runs here, on the domain the passkey is bound to.
  useEffect(() => {
    const h = currentHandle();
    if (h) setName(h);
  }, []);

  const onHandle = currentHandle();

  // Debounced live name resolution against the naming service.
  useEffect(() => {
    const base = name.trim().toLowerCase().replace(/\.(impact)$/, "");
    if (!base) { setLookup({ status: "idle" }); return; }
    const id = ++seq.current;
    setLookup({ status: "checking" });
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/connect/name-info?name=${encodeURIComponent(base)}`);
        const info = (await r.json()) as NameInfo;
        if (id !== seq.current) return; // a newer keystroke superseded this
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
  }, [name]);

  const isOpen = lookup.status === "exists";
  // Which credential buttons to show: an existing home shows only its registered
  // credential(s); anything else (free / typing / empty) shows all create methods.
  const shown = isOpen
    ? credentialMethods.filter((m) => (lookup as { vias: Via[] }).vias.includes(m.via))
    : credentialMethods;

  async function enter(via: Via) {
    const label = name.trim().toLowerCase().replace(/\.impact$/, "").replace(/[^a-z0-9-]/g, "");
    // Passkeys are bound to the host. A named home must be connected on its own
    // subdomain (<handle>.<domain>) so the passkey is associated with that named
    // domain. If we're not already there, switch to it first (then connect).
    if (via === "passkey" && label && onHandle !== label) {
      setBusy(via);
      setStep(`Switching to ${label}’s home…`);
      window.location.href = `${homeOrigin(label)}/`;
      return;
    }
    setBusy(via);
    setError(null);
    setStep(via === "passkey" ? "Touch your authenticator…" : via === "wallet" ? "Confirm in your wallet…" : "Redirecting…");
    const err = await signIn(via, name.trim() || undefined);
    if (err) { setError(err); setBusy(null); setStep(null); }
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

        <h1 className="h1" style={{ marginBottom: ".4rem" }}>
          {isOpen ? "Welcome back" : copy.enterTitle}
        </h1>
        <p className="muted" style={{ marginBottom: "1.3rem" }}>
          {isOpen
            ? "This home is already registered — open it with your credential below."
            : copy.enterSub.replace("{community}", brand.community)}
        </p>

        <label className="faint" style={{ fontSize: ".74rem", fontWeight: 600 }}>Your name</label>
        <div className="row" style={{ gap: ".4rem", margin: ".35rem 0 .5rem" }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="grace"
            disabled={busy !== null}
            autoFocus
            style={{
              flex: 1, padding: ".6rem .8rem", borderRadius: "var(--r-md)",
              border: "1px solid var(--border-strong)", background: "var(--surface-raised)",
              fontSize: ".92rem", color: "var(--ink)",
            }}
          />
          <span className="addr">.impact</span>
        </div>

        {/* Live naming-service status */}
        <div style={{ minHeight: 22, marginBottom: ".9rem", fontSize: ".78rem" }}>
          {lookup.status === "checking" && <span className="faint">Checking the naming service…</span>}
          {lookup.status === "free" && (
            <span style={{ color: "var(--emerald-700)" }}>
              <IconCheck width={13} height={13} style={{ verticalAlign: "-2px" }} /> {lookup.name} is available — secure it as your new home.
            </span>
          )}
          {lookup.status === "exists" && (
            <span className="muted">
              {lookup.name} is registered — opens with{" "}
              <strong>{lookup.vias.join(" or ")}</strong>.
            </span>
          )}
          {lookup.status === "orphan" && (
            <span style={{ color: "var(--amber-700)" }}>
              {lookup.name} has an incomplete previous setup — try again or pick another name.
            </span>
          )}
          {lookup.status === "error" && <span className="faint">Couldn’t reach the naming service — you can still proceed.</span>}
        </div>

        {error && (
          <div className="card-pad chip-danger" style={{ borderRadius: "var(--r-md)", marginBottom: "1rem", fontSize: ".82rem" }}>
            {error}
          </div>
        )}

        <div className="col" style={{ gap: ".7rem" }}>
          {shown.map((m) => (
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
                <span>{busy === m.via ? (step ?? "Working…") : isOpen ? openLabel(m.via) : m.label}</span>
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

function openLabel(via: Via): string {
  switch (via) {
    case "passkey": return "Open with your passkey";
    case "wallet": return "Open with your wallet";
    case "google": return "Open with Google";
    case "youversion": return "Open with YouVersion";
  }
}
