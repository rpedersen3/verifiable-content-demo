"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "@/context/session";
import { orgById, servicesForOrg } from "@/lib/seed";
import { Glyph, SectionHead, Pill, TrustMeter, EmptyNote } from "@/components/ui";
import { IconPlus, IconOrg } from "@/components/Icons";
import { usePersonOrgs, type LiveOrg } from "@/lib/use-live";
import { createOrg } from "@/lib/connect";
import { activateVaultKey } from "@/lib/vault-key";
import { orgHome } from "@/lib/workspace";
import type { Organization } from "@/lib/types";
import type { Via } from "@/context/session";

const EXPLORER = "https://sepolia.basescan.org/address/";

export default function OrganizationsPage() {
  const { person, identity, token, setDefaultOrg, defaultOrgId } = useSession();
  const router = useRouter();
  const isOrg = false; // this page always renders the person's own org list
  const via = identity?.via ?? "passkey";
  const deployed = !!identity?.deployed;

  const [refreshKey, setRefreshKey] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [orgName, setOrgName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Live organizations the person governs, read from the home vault (kind 'org').
  const live = usePersonOrgs(isOrg ? null : token, refreshKey);

  if (!person) return null;

  const custody = person.custodyOf.map(orgById).filter(Boolean) as Organization[];
  const member = person.membershipIds.map(orgById).filter(Boolean) as Organization[];

  // Entering a workspace = navigating to its URL; the AppShell derives `active` from the path.
  function enterAsCustodian(orgId: string) {
    router.push(orgHome(orgId));
  }

  function enterLiveAsCustodian(org: LiveOrg) {
    router.push(orgHome(org.agent));
  }

  async function onCreate() {
    if (!person) return;
    const name = orgName.trim();
    if (!name) { setErr("Give your organization a name."); return; }
    if (!deployed) { setErr("First secure your home on-chain — Account → Secure my home — then create an organization."); return; }
    setErr(null);
    const out = await createOrg({ name, personSA: person.address, via, token: token ?? undefined }, setBusy);
    if (!out.ok) { setBusy(null); setErr(out.error); return; }
    // Give the org its OWN encrypted vault straight away — you sign its vault-key authorization as
    // its on-chain custodian (ERC-1271). Non-fatal: the org exists either way; surface a soft note.
    setBusy("Activating the organization's vault…");
    const act = await activateVaultKey(out.agent, via, token ?? undefined);
    setBusy(null);
    setShowCreate(false);
    setOrgName("");
    setRefreshKey((k) => k + 1);
    if (!act.ok) setErr(`Organization created, but activating its vault failed: ${act.error}. You can retry from the org's Vault.`);
  }

  const hasAny = custody.length + member.length + live.orgs.length > 0;

  return (
    <>
      <SectionHead
        eyebrow="Organizations"
        title="Organizations"
        sub="The communities you steward and belong to. Switch into a custodian context to manage one, or pin it as your default home."
        action={
          <button className="btn btn-ghost btn-sm" onClick={() => { setShowCreate((s) => !s); setErr(null); }}>
            <IconPlus width={15} height={15} /> {showCreate ? "Cancel" : "Connect or create an org"}
          </button>
        }
      />

      {/* Create panel — deploys a person-governed organization Smart Agent (gas-free), stewarded by you. */}
      {showCreate && (
        <div className="card card-pad" style={{ marginBottom: "1.4rem" }}>
          <div className="row" style={{ gap: ".7rem", alignItems: "flex-start" }}>
            <div className="glyph glyph-sm" style={{ background: "var(--surface-sunken)", color: "var(--emerald-700)" }}>
              <IconOrg width={16} height={16} />
            </div>
            <div style={{ flex: 1 }}>
              <strong style={{ fontSize: ".95rem" }}>Create an organization</strong>
              <div className="muted" style={{ fontSize: ".84rem", marginTop: 3 }}>
                It deploys as its own Smart Agent (<code className="mono">&lt;name&gt;.impact</code>) with a
                stewardship grant back to you — no service holds its key. Gas is sponsored.
              </div>
              {!deployed && (
                <p className="muted" style={{ marginTop: ".7rem" }}>
                  First secure your home on-chain — go to <Link href="/account">Account → Secure my home</Link>.
                </p>
              )}
              <div className="row" style={{ gap: ".5rem", marginTop: ".9rem" }}>
                <input
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="Organization name (e.g. Grace Chapel)"
                  aria-label="Organization name"
                  onKeyDown={(e) => { if (e.key === "Enter" && !busy) onCreate(); }}
                  style={{ flex: 1, maxWidth: 320, padding: ".5rem .65rem", borderRadius: "var(--r-sm)", border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--ink)", fontFamily: "inherit" }}
                />
                <button className="btn btn-primary btn-sm" onClick={onCreate} disabled={!!busy || !deployed}>
                  <IconPlus width={15} height={15} /> {busy ? busy : "Create organization"}
                </button>
              </div>
              {err && <div className="muted" style={{ marginTop: ".6rem", color: "var(--danger)" }}>{err}</div>}
            </div>
          </div>
        </div>
      )}

      {!hasAny && !live.loading && !showCreate && (
        <EmptyNote>
          <div style={{ marginBottom: ".7rem" }}>
            You&apos;re not connected to any organizations yet. Organizations are agents you steward
            (a church, ministry, or coalition) — each with its own treasury, security, and service agents.
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>
            <IconPlus width={15} height={15} /> Connect or create an organization
          </button>
        </EmptyNote>
      )}

      {/* Live organizations the person created (vault-detected). */}
      {live.orgs.length > 0 && <div className="eyebrow" style={{ marginBottom: ".6rem" }}>You steward (live)</div>}
      {live.orgs.length > 0 && (
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(330px, 1fr))", marginBottom: "1.6rem" }}>
          {live.orgs.map((o) => <LiveOrgCard key={o.agent} org={o} onManage={() => enterLiveAsCustodian(o)} />)}
        </div>
      )}

      {custody.length > 0 && <div className="eyebrow" style={{ marginBottom: ".6rem" }}>You steward</div>}
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(330px, 1fr))", marginBottom: "1.6rem" }}>
        {custody.map((o) => (
          <OrgCard key={o.id} org={o} role="custodian" isDefault={defaultOrgId === o.id}
            onEnter={() => enterAsCustodian(o.id)}
            onPin={() => setDefaultOrg(defaultOrgId === o.id ? null : o.id)} />
        ))}
      </div>

      {member.length > 0 && <div className="eyebrow" style={{ marginBottom: ".6rem" }}>You belong to</div>}
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(330px, 1fr))" }}>
        {member.map((o) => (
          <OrgCard key={o.id} org={o} role="member" isDefault={false} />
        ))}
      </div>
    </>
  );
}

/** A live, on-chain organization the person created — custodied by you, with its own vault. */
function LiveOrgCard({ org, onManage }: { org: LiveOrg; onManage: () => void }) {
  const display = org.name ?? `${org.agent.slice(0, 6)}…${org.agent.slice(-4)}`;
  return (
    <div className="card card-pad">
      <div className="row" style={{ gap: ".8rem" }}>
        <Glyph kind="org" name={display} size="md" />
        <div style={{ flex: 1 }}>
          <div className="row-between">
            <strong>{display}</strong>
            <Pill tone="amber">custodian</Pill>
          </div>
          <div className="muted" style={{ fontSize: ".82rem" }}>
            {org.name ? "Your organization, on-chain — you steward it; it has its own vault." : "Nameless organization — its address is its id; you can name it later."}
          </div>
        </div>
      </div>
      <div className="row wrap" style={{ gap: ".4rem", marginTop: ".9rem" }}>
        <a href={`${EXPLORER}${org.agent}`} target="_blank" rel="noreferrer" className="addr">
          {org.agent.slice(0, 10)}…{org.agent.slice(-6)} · explorer ↗
        </a>
        <Pill tone="emerald"><span className="dot" /> Base Sepolia</Pill>
      </div>
      <div className="row" style={{ gap: ".5rem", marginTop: "1rem" }}>
        <button className="btn btn-primary btn-sm" onClick={onManage}>Manage as custodian</button>
      </div>
    </div>
  );
}

function OrgCard({
  org, role, isDefault, onEnter, onPin,
}: {
  org: Organization;
  role: "custodian" | "member";
  isDefault: boolean;
  onEnter?: () => void;
  onPin?: () => void;
}) {
  return (
    <div className="card card-pad">
      <div className="row" style={{ gap: ".8rem" }}>
        <Glyph kind="org" name={org.name} size="md" />
        <div style={{ flex: 1 }}>
          <div className="row-between">
            <strong>{org.name}</strong>
            <Pill tone={role === "custodian" ? "amber" : "default"}>{role}</Pill>
          </div>
          <div className="muted" style={{ fontSize: ".82rem" }}>{org.profile.mission}</div>
        </div>
      </div>

      {org.trust && (
        <div style={{ marginTop: ".9rem" }}>
          <div className="row-between" style={{ marginBottom: 5 }}>
            <span className="faint" style={{ fontSize: ".74rem" }}>Org trust · {org.trust.corroborations} sources</span>
            <strong style={{ fontSize: ".84rem" }}>{Math.round(org.trust.overall * 100)}%</strong>
          </div>
          <TrustMeter value={org.trust.overall} />
        </div>
      )}

      <div className="row wrap" style={{ gap: ".4rem", marginTop: ".9rem" }}>
        <Pill tone="plum">{servicesForOrg(org.id).length} service agents</Pill>
        <Pill>{org.memberIds.length} members</Pill>
        <Pill tone="emerald">${org.treasury.balanceUsdc.toLocaleString()}</Pill>
      </div>

      {role === "custodian" && (
        <div className="row" style={{ gap: ".5rem", marginTop: "1rem" }}>
          <button className="btn btn-primary btn-sm" onClick={onEnter}>Manage as custodian</button>
          <button className="btn btn-ghost btn-sm" onClick={onPin}>{isDefault ? "★ Default" : "Set default"}</button>
        </div>
      )}
    </div>
  );
}
