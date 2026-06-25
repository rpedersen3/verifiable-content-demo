"use client";

// Profile management — edit the member's COMMUNITY CONTACT profile (name/email/phone/org). It lives
// in the member's PER-PERSON ENCRYPTED vault at impact-mcp (spec 278 — the `vault:impact-profile`
// record, sealed under their own GCP KMS KEK), read/written over the same-origin `/mcp-bind` proxy.
// No copy is held at the home. Until the member activates their vault key (Account → Activate vault
// key), the vault is fail-closed and this page prompts them to do so.

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSession } from "@/context/session";
import { SectionHead } from "@/components/ui";
import { IconUser } from "@/components/Icons";
import {
  loadImpactProfile, saveImpactProfile, PROFILE_FIELDS, VaultKeyUnauthorizedError,
  type ImpactStoredProfile, type ImpactContactProfile, type ImpactProfileFieldKey,
} from "@/lib/profile-store";
import { setCachedProfileName, displayNameFromContact } from "@/lib/profile-name";

const inputStyle: React.CSSProperties = {
  width: "100%", padding: ".6rem .75rem", fontSize: ".92rem", borderRadius: "var(--r-sm)",
  border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--ink)", fontFamily: "inherit",
};

export default function ProfilePage() {
  const { identity } = useSession();
  const address = identity?.address;
  const [stored, setStored] = useState<ImpactStoredProfile | null>(null);
  const [contact, setContact] = useState<ImpactContactProfile>({});
  const [loading, setLoading] = useState(true);
  const [needsVaultKey, setNeedsVaultKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    setLoading(true); setNeedsVaultKey(false); setError(null);
    loadImpactProfile(address as `0x${string}`)
      .then((p) => { if (!cancelled) { setStored(p); setContact(p.contact ?? {}); setCachedProfileName(address, displayNameFromContact(p.contact)); } })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof VaultKeyUnauthorizedError) setNeedsVaultKey(true);
        else setError("Could not load your profile from your encrypted vault. Try again.");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [address]);

  function change(key: ImpactProfileFieldKey, v: string) {
    setContact((c) => ({ ...c, [key]: v }));
    setSaved(false);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!address) return;
    setSubmitting(true); setError(null); setSaved(false);
    try {
      const next: ImpactStoredProfile = { v: 1, contact, attestations: stored?.attestations };
      await saveImpactProfile(address as `0x${string}`, next);
      setStored(next);
      setCachedProfileName(address, displayNameFromContact(contact));
      setSaved(true);
    } catch (err) {
      if (err instanceof VaultKeyUnauthorizedError) setNeedsVaultKey(true);
      else setError("Could not save to your encrypted vault. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!identity) return null;

  return (
    <>
      <SectionHead
        eyebrow="Profile management"
        title="Your profile"
        sub="These details live in your private, end-to-end encrypted vault — re-used across the community apps you trust. You decide which app sees what."
      />

      {needsVaultKey ? (
        <div className="card card-pad" style={{ maxWidth: 620, display: "flex", gap: "1rem", alignItems: "flex-start" }}>
          <div className="glyph glyph-sm" style={{ background: "var(--grad-amber)", color: "#1c1917", flex: "0 0 auto" }}>
            <IconUser width={18} height={18} />
          </div>
          <div style={{ flex: 1 }}>
            <div className="h3" style={{ marginBottom: ".25rem" }}>Activate your vault key first</div>
            <p className="muted" style={{ marginBottom: ".9rem" }}>
              Your profile is kept in your private, end-to-end encrypted vault — not in this browser.
              Activate your vault key once and you can edit it here, sealed under your own key.
            </p>
            <Link href="/account" className="btn btn-primary btn-sm" style={{ textDecoration: "none" }}>
              Go to Account → Activate vault key
            </Link>
          </div>
        </div>
      ) : loading ? (
        <div className="muted">Loading your profile from your encrypted vault…</div>
      ) : (
        <form onSubmit={onSubmit} className="card card-pad" style={{ maxWidth: 620, display: "flex", flexDirection: "column", gap: "1.1rem" }}>
          {PROFILE_FIELDS.map((f) => (
            <div key={f.key} className="col" style={{ gap: ".35rem" }}>
              <label htmlFor={`p-${f.key}`} style={{ fontWeight: 650, fontSize: ".82rem", color: "var(--ink)" }}>{f.label}</label>
              <input
                id={`p-${f.key}`}
                type={f.type}
                value={contact[f.key] ?? ""}
                onChange={(e) => change(f.key, e.target.value)}
                placeholder={f.placeholder}
                style={inputStyle}
              />
              <span className="faint" style={{ fontSize: ".72rem" }}>{f.help}</span>
            </div>
          ))}

          {error && <div className="muted" style={{ color: "var(--danger)" }}>{error}</div>}
          {saved && <div style={{ color: "var(--emerald-600)", fontWeight: 600, fontSize: ".88rem" }}>✓ Saved to your vault</div>}

          <div className="row" style={{ gap: ".8rem", marginTop: ".2rem" }}>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? "Saving…" : "Save"}
            </button>
            <span className="faint" style={{ fontSize: ".72rem" }}>Sealed under your own KMS key — the home holds no copy.</span>
          </div>
        </form>
      )}
    </>
  );
}
