"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSession, type LiveOrgRef } from "@/context/session";
import { orgById, PERSON, PEERS } from "@/lib/seed";
import { Glyph, SectionHead, Pill, EmptyNote } from "@/components/ui";
import { IconOrg } from "@/components/Icons";
import { orgHref } from "@/lib/workspace";
import { orgDisplay } from "@/lib/org-name";
import type { AccessContext } from "@/lib/access";
import { activateVaultKey } from "@/lib/vault-key";
import {
  loadImpactOrgProfile, saveImpactOrgProfile, ORG_PROFILE_FIELDS, VaultKeyUnauthorizedError,
  type ImpactOrgProfile,
} from "@/lib/org-profile-store";

const EXPLORER = "https://sepolia.basescan.org/address/";

export default function OrganizationPage() {
  const { active } = useSession();
  if (active.mode !== "org") {
    return (
      <div className="card card-pad" style={{ textAlign: "center", padding: "2.5rem" }}>
        <div className="h2" style={{ marginBottom: ".5rem" }}>Switch into a custodian context</div>
        <p className="muted" style={{ marginBottom: "1rem" }}>Use the context switcher to manage one of your organizations.</p>
        <Link href="/organizations" className="btn btn-primary btn-sm">Choose an organization</Link>
      </div>
    );
  }
  const org = orgById(active.orgId);
  if (!org) {
    // A LIVE org: its profile is editable + sealed in the org's own vault (vault:impact-org-profile).
    if (active.live) return <LiveOrgProfile live={active.live} />;
    return (
      <div className="card card-pad" style={{ textAlign: "center", padding: "2.5rem" }}>
        <div className="muted">Loading this organization…</div>
      </div>
    );
  }

  const memberLookup = (id: string) => (id === PERSON.id ? PERSON : PEERS.find((p) => p.id === id));
  const fields = [
    { label: "Display name", value: org.profile.displayName },
    { label: "Mission", value: org.profile.mission },
    { label: "Sector", value: org.profile.sector },
    { label: "Website", value: org.profile.website },
    { label: "Contact", value: org.profile.contactEmail },
    { label: "Location", value: org.profile.location },
  ];

  return (
    <>
      <SectionHead
        eyebrow="Organization"
        title={org.name}
        sub="The organization's public identity and people. Stored in the org vault as org:profile, read by you over a stewardship delegation."
        action={<button className="btn btn-ghost btn-sm">Edit profile</button>}
      />

      <div className="card card-pad" style={{ marginBottom: "1.4rem" }}>
        <div className="row" style={{ gap: "1rem" }}>
          <Glyph kind="org" name={org.name} size="lg" />
          <div className="row wrap" style={{ gap: ".4rem" }}>
            <span className="addr">{org.agentName}</span>
            <span className="addr">{org.address.slice(0, 10)}…{org.address.slice(-6)}</span>
          </div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", marginBottom: "1.4rem" }}>
        <div className="card" style={{ overflow: "hidden" }}>
          {fields.filter((f) => f.value).map((f, i) => (
            <div key={f.label} style={{ padding: ".85rem 1.1rem", borderTop: i ? "1px solid var(--border)" : undefined }}>
              <div className="faint" style={{ fontSize: ".72rem" }}>{f.label}</div>
              <div style={{ fontWeight: 550, fontSize: ".9rem" }}>{f.value}</div>
            </div>
          ))}
        </div>

        <div className="col" style={{ gap: "1rem" }}>
          <div className="card card-pad">
            <div className="eyebrow" style={{ marginBottom: ".6rem" }}>Custodians</div>
            {org.custodians.map((id) => {
              const p = memberLookup(id);
              return p ? (
                <div key={id} className="row" style={{ gap: ".6rem", marginBottom: ".5rem" }}>
                  <Glyph kind="person" name={p.name} size="sm" />
                  <div style={{ flex: 1 }}><strong style={{ fontSize: ".88rem" }}>{p.name}</strong></div>
                  <Pill tone="amber">custodian</Pill>
                </div>
              ) : null;
            })}
          </div>
          <div className="card card-pad">
            <div className="eyebrow" style={{ marginBottom: ".6rem" }}>Members ({org.memberIds.length})</div>
            {org.memberIds.map((id) => {
              const p = memberLookup(id);
              return p ? (
                <div key={id} className="row" style={{ gap: ".6rem", marginBottom: ".4rem" }}>
                  <Glyph kind="person" name={p.name} size="sm" />
                  <span style={{ fontSize: ".88rem" }}>{p.name}</span>
                </div>
              ) : null;
            })}
          </div>
        </div>
      </div>
    </>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: ".55rem .7rem", fontSize: ".9rem", borderRadius: "var(--r-sm)",
  border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--ink)", fontFamily: "inherit",
};

/** A live org's standard profile — display name, mission, sector, website, contact, location —
 *  sealed in the ORG's own vault (vault:impact-org-profile) and read/written by the custodian over
 *  the org→person stewardship delegation. */
function LiveOrgProfile({ live }: { live: LiveOrgRef }) {
  const { token } = useSession();
  const accessCtx = useMemo<AccessContext | null>(
    () => (live.stewardship ? { kind: "org", orgSA: live.address, requester: live.custodian, stewardship: live.stewardship } : null),
    [live.address, live.custodian, live.stewardship],
  );

  const [profile, setProfile] = useState<ImpactOrgProfile>({});
  const [form, setForm] = useState<ImpactOrgProfile>({});
  const [loading, setLoading] = useState(true);
  const [needsKey, setNeedsKey] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!accessCtx) { setLoading(false); return; }
    let alive = true;
    setLoading(true); setNeedsKey(false); setErr(null);
    loadImpactOrgProfile(accessCtx)
      .then((p) => { if (alive) { setProfile(p); setForm(p); } })
      .catch((e) => { if (alive) { if (e instanceof VaultKeyUnauthorizedError) setNeedsKey(true); else setErr("Could not load this org's profile from its vault."); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [accessCtx, refresh]);

  async function onSave() {
    if (!accessCtx) return;
    setSaving(true); setErr(null); setSaved(false);
    try {
      await saveImpactOrgProfile(accessCtx, form);
      setProfile(form); setEditing(false); setSaved(true);
    } catch (e) {
      if (e instanceof VaultKeyUnauthorizedError) setNeedsKey(true);
      else setErr(e instanceof Error ? e.message : "Could not save to the org's vault.");
    } finally { setSaving(false); }
  }

  async function onActivate() {
    setActivating(true); setErr(null);
    const out = await activateVaultKey(live.address, live.via, token ?? undefined);
    setActivating(false);
    if (out.ok) { setNeedsKey(false); setRefresh((k) => k + 1); } else setErr(out.error);
  }

  const filled = ORG_PROFILE_FIELDS.filter((f) => ((profile[f.key] ?? "") as string).trim());
  // Prefer the org's display name (from its vault profile) over its .impact name / address.
  const display = (profile.displayName && profile.displayName.trim()) || orgDisplay(live.address, live.name);

  return (
    <>
      <SectionHead
        eyebrow="Organization"
        title={display}
        sub="This organization's public profile, sealed in its own vault (vault:impact-org-profile) and read by you over a stewardship delegation — never via custody."
        action={!needsKey && !loading ? <button className="btn btn-ghost btn-sm" onClick={() => { setForm(profile); setEditing((e) => !e); setSaved(false); }}>{editing ? "Cancel" : "Edit profile"}</button> : undefined}
      />

      <div className="card card-pad" style={{ marginBottom: "1.4rem" }}>
        <div className="row" style={{ gap: "1rem" }}>
          <Glyph kind="org" name={display} size="lg" />
          <div className="row wrap" style={{ gap: ".4rem" }}>
            {live.name && <span className="addr">{live.name}</span>}
            <a href={`${EXPLORER}${live.address}`} target="_blank" rel="noreferrer" className="addr">
              {live.address.slice(0, 10)}…{live.address.slice(-6)} · explorer ↗
            </a>
            <Pill tone="amber">you are custodian</Pill>
          </div>
        </div>
      </div>

      {err && <div className="muted" style={{ marginBottom: "1rem", color: "var(--danger)" }}>{err}</div>}
      {saved && <div className="muted" style={{ marginBottom: "1rem", color: "var(--emerald-700)" }}>Saved to the org&apos;s vault.</div>}

      {!accessCtx ? (
        <EmptyNote>This org&apos;s stewardship grant isn&apos;t loaded, so its profile can&apos;t be managed here. Re-enter it from <Link href="/organizations">Organizations</Link>.</EmptyNote>
      ) : needsKey ? (
        <EmptyNote>
          <div style={{ marginBottom: ".7rem" }}>
            To store {display}&apos;s profile, activate its vault for this record. As its custodian you sign the
            authorization with your own credential — its profile is then encrypted under the org&apos;s own key.
          </div>
          <button className="btn btn-primary btn-sm" onClick={onActivate} disabled={activating}>
            <IconOrg width={15} height={15} /> {activating ? "Activating…" : "Activate the organization vault"}
          </button>
        </EmptyNote>
      ) : loading ? (
        <div className="muted">Reading the org&apos;s vault…</div>
      ) : editing ? (
        <div className="card card-pad col" style={{ gap: ".9rem", maxWidth: 640 }}>
          {ORG_PROFILE_FIELDS.map((f) => (
            <label key={f.key} className="col" style={{ gap: ".3rem" }}>
              <span style={{ fontWeight: 600, fontSize: ".86rem" }}>{f.label}</span>
              {f.type === "textarea" ? (
                <textarea value={(form[f.key] ?? "") as string} onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))} placeholder={f.placeholder} rows={3} style={inputStyle} />
              ) : (
                <input type={f.type} value={(form[f.key] ?? "") as string} onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))} placeholder={f.placeholder} style={inputStyle} />
              )}
              <span className="faint" style={{ fontSize: ".72rem" }}>{f.help}</span>
            </label>
          ))}
          <div className="row" style={{ gap: ".5rem" }}>
            <button className="btn btn-primary btn-sm" onClick={onSave} disabled={saving}>{saving ? "Sealing…" : "Save to vault"}</button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setEditing(false); setForm(profile); }} disabled={saving}>Cancel</button>
          </div>
        </div>
      ) : filled.length === 0 ? (
        <EmptyNote>
          <div style={{ marginBottom: ".7rem" }}>{display} doesn&apos;t have a profile yet.</div>
          <button className="btn btn-primary btn-sm" onClick={() => { setForm(profile); setEditing(true); }}>Add the organization profile</button>
        </EmptyNote>
      ) : (
        <div className="card" style={{ overflow: "hidden", maxWidth: 640 }}>
          {filled.map((f, i) => (
            <div key={f.key} style={{ padding: ".85rem 1.1rem", borderTop: i ? "1px solid var(--border)" : undefined }}>
              <div className="faint" style={{ fontSize: ".72rem" }}>{f.label}</div>
              <div style={{ fontWeight: 550, fontSize: ".9rem", whiteSpace: "pre-wrap" }}>{(profile[f.key] ?? "") as string}</div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
