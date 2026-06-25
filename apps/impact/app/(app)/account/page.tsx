"use client";

// Account — the person's administrative surface: who you are, activating your private vault key,
// recovery, sign-in methods, and signing out. (Day-to-day app features live in the left sidebar.)

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "@/context/session";
import { SectionHead, Pill } from "@/components/ui";
import { IconKey, IconShield, IconLink, IconSignOut, IconCheck } from "@/components/Icons";
import { loadImpactProfile, VaultKeyUnauthorizedError } from "@/lib/profile-store";
import { activateVaultKey } from "@/lib/vault-key";

const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const VIA_LABEL: Record<string, string> = { passkey: "Passkey", wallet: "Wallet", google: "Google", youversion: "YouVersion" };

export default function AccountPage() {
  const { identity, signOut } = useSession();
  const address = identity?.address;
  const via = identity?.via ?? "passkey";

  const [vaultStatus, setVaultStatus] = useState<"checking" | "active" | "inactive">("checking");
  const [activating, setActivating] = useState(false);
  const [activateError, setActivateError] = useState<string | null>(null);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    setVaultStatus("checking");
    loadImpactProfile(address as `0x${string}`)
      .then(() => { if (!cancelled) setVaultStatus("active"); })
      .catch((err) => { if (!cancelled) setVaultStatus(err instanceof VaultKeyUnauthorizedError ? "inactive" : "active"); });
    return () => { cancelled = true; };
  }, [address]);

  async function onActivate() {
    if (!address) return;
    setActivating(true); setActivateError(null);
    const out = await activateVaultKey(address as `0x${string}`, via);
    if (out.ok) setVaultStatus("active");
    else setActivateError(out.error);
    setActivating(false);
  }

  if (!identity) return null;
  const display = identity.name ? (identity.name.endsWith(".impact") ? identity.name : `${identity.name}.impact`) : shortAddr(identity.address);

  return (
    <>
      <SectionHead eyebrow="Account" title="Account" sub="Your identity, your private vault key, recovery, and how you sign in. Only you open this home." />

      {/* Identity */}
      <div className="card card-pad" style={{ maxWidth: 720, marginBottom: "1.1rem" }}>
        <div className="row-between" style={{ marginBottom: ".6rem" }}>
          <span className="eyebrow">Your home</span>
          {identity.deployed ? <Pill tone="emerald">deployed</Pill> : <Pill tone="amber">counterfactual</Pill>}
        </div>
        <div className="h2" style={{ marginBottom: ".25rem" }}>{display}</div>
        <div className="row wrap" style={{ gap: ".5rem" }}>
          <span className="addr" title={identity.address}>{identity.address}</span>
          <Pill>signed in via {VIA_LABEL[via] ?? via}</Pill>
        </div>
      </div>

      {/* Vault key */}
      <div className="card card-pad" style={{ maxWidth: 720, marginBottom: "1.1rem", display: "flex", gap: "1rem", alignItems: "flex-start" }}>
        <div className="glyph glyph-sm" style={{ background: "var(--grad-amber)", color: "#1c1917", flex: "0 0 auto" }}><IconKey width={18} height={18} /></div>
        <div style={{ flex: 1 }}>
          <div className="row-between">
            <div className="h3">Private vault key</div>
            {vaultStatus === "active" && <Pill tone="emerald">active</Pill>}
            {vaultStatus === "inactive" && <Pill tone="amber">not activated</Pill>}
          </div>
          <p className="muted" style={{ margin: ".4rem 0 .8rem" }}>
            Your profile and data are sealed in your own end-to-end encrypted vault. Activating authorizes
            impact-mcp to use your per-person KMS key — read/write, non-subdelegable, revocable. Until you do,
            your vault is fail-closed: no one (not even impact) can decrypt your data.
          </p>
          {vaultStatus === "checking" && <span className="faint">Checking your vault…</span>}
          {vaultStatus === "active" && <span className="row" style={{ gap: ".4rem", color: "var(--emerald-600)", fontWeight: 600, fontSize: ".88rem" }}><IconCheck width={16} height={16} /> Your vault is live — edit your <Link href="/profile">profile</Link>.</span>}
          {vaultStatus === "inactive" && (
            <div className="col" style={{ gap: ".5rem" }}>
              <button className="btn btn-primary btn-sm" onClick={onActivate} disabled={activating}>
                {activating ? "Signing + activating…" : `Activate vault key (sign with your ${VIA_LABEL[via] ?? via})`}
              </button>
              {activateError && <span className="muted" style={{ color: "var(--danger)" }}>{activateError}</span>}
            </div>
          )}
        </div>
      </div>

      {/* Recovery */}
      <div className="card card-pad" style={{ maxWidth: 720, marginBottom: "1.1rem", display: "flex", gap: "1rem", alignItems: "flex-start" }}>
        <div className="glyph glyph-sm" style={{ background: "var(--surface-sunken)", color: "var(--text-faint)", flex: "0 0 auto" }}><IconShield width={18} height={18} /></div>
        <div style={{ flex: 1 }}>
          <div className="row-between"><div className="h3">Recovery</div><Pill>soon</Pill></div>
          <p className="muted" style={{ margin: ".4rem 0 0" }}>
            Trustees and guardians who can help you recover this home if you lose access — without ever
            changing your identity or being able to act as you. Coming soon.
          </p>
        </div>
      </div>

      {/* Sign-in methods */}
      <div className="card card-pad" style={{ maxWidth: 720, marginBottom: "1.1rem", display: "flex", gap: "1rem", alignItems: "flex-start" }}>
        <div className="glyph glyph-sm" style={{ background: "var(--surface-sunken)", color: "var(--text-faint)", flex: "0 0 auto" }}><IconLink width={18} height={18} /></div>
        <div style={{ flex: 1 }}>
          <div className="h3" style={{ marginBottom: ".25rem" }}>Sign-in methods & devices</div>
          <p className="muted" style={{ marginBottom: ".7rem" }}>Add a backup passkey or wallet, manage linked devices, and review active sessions.</p>
          <Link href="/security" className="btn btn-ghost btn-sm" style={{ textDecoration: "none" }}>Manage security →</Link>
        </div>
      </div>

      {/* Sign out */}
      <div style={{ maxWidth: 720 }}>
        <button className="btn btn-ghost btn-sm" onClick={signOut}>
          <IconSignOut width={15} height={15} /> Sign out
        </button>
      </div>
    </>
  );
}
