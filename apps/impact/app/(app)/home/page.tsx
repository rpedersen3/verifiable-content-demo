"use client";

import Link from "next/link";
import { useSession } from "@/context/session";
import { ACTIVITY, orgById, servicesForOrg } from "@/lib/seed";
import { Glyph, SectionHead, StatTile, TrustMeter, DimensionBadges, Pill, EmptyNote } from "@/components/ui";
import { IconVault, IconWallet, IconShield, IconGraph, IconBot, IconOrg, IconPlus } from "@/components/Icons";
import { useAgentBalances, usePersonTreasury } from "@/lib/use-live";
import type { LiveOrgRef } from "@/context/session";

const EXPLORER = "https://sepolia.basescan.org/address/";

export default function HomePage() {
  const { person, active } = useSession();
  if (!person) return null;
  if (active.mode === "org") {
    return active.live ? <LiveOrgDashboard live={active.live} /> : <OrgDashboard orgId={active.orgId} />;
  }
  return <PersonDashboard />;
}

/** Dashboard for a LIVE org the connected person custodies — real identity + on-chain balance, with
 *  its own vault (keyed by the org SA). Seeded trust/services/members don't apply yet. */
function LiveOrgDashboard({ live }: { live: LiveOrgRef }) {
  const bal = useAgentBalances(live.address);
  const display = live.name ?? `${live.address.slice(0, 6)}…${live.address.slice(-4)}`;
  return (
    <>
      <SectionHead eyebrow="Acting as custodian" title={display} sub="An organization you steward. It has its own Smart Agent, vault, and treasury — and you hold its key only by signing as its custodian." />

      <div className="card card-pad" style={{ marginBottom: "1.2rem" }}>
        <div className="row" style={{ gap: "1rem", alignItems: "flex-start" }}>
          <Glyph kind="org" name={display} size="lg" />
          <div style={{ flex: 1 }}>
            <div className="row wrap" style={{ gap: ".4rem" }}>
              {live.name && <span className="addr">{live.name}</span>}
              <a href={`${EXPLORER}${live.address}`} target="_blank" rel="noreferrer" className="addr">
                {live.address.slice(0, 10)}…{live.address.slice(-6)} · explorer ↗
              </a>
              <Pill tone="amber">you are custodian</Pill>
            </div>
            <div className="muted" style={{ fontSize: ".86rem", marginTop: ".7rem" }}>
              Stewardship is on-chain: this org granted you a delegation to read and oversee its vault, and its
              Smart Agent is custodied by your own credential. Nothing here holds a private key on your behalf.
            </div>
          </div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: "1.4rem" }}>
        <StatTile num={bal.loading ? "…" : `$${bal.usdc ?? "0.00"}`} label="Org USDC (live)" accent="var(--emerald-700)" />
        <StatTile num={bal.loading ? "…" : `${bal.eth ?? "0"}`} label="ETH (live)" />
        <StatTile num={live.name ? "Named" : "Nameless"} label="Identity" />
        <StatTile num="Custodian" label="Your role" />
      </div>

      <SectionHead title="Manage this organization" sub="Its vault, security, and trust — acting as custodian." />
      <div className="grid" style={{ gridTemplateColumns: "repeat(2, 1fr)", marginBottom: "1.6rem" }}>
        <QuickLink href="/vault" icon={<IconVault />} title="Organization vault" sub="PII, credentials, delegations — under the org's key" />
        <QuickLink href="/treasury" icon={<IconWallet />} title="Treasury" sub="Org balance & giving" />
        <QuickLink href="/trust-graph" icon={<IconGraph />} title="Trust graph" sub="The org's relationships" />
        <QuickLink href="/security" icon={<IconShield />} title="Security" sub="Custody & sessions" />
      </div>
    </>
  );
}

function PersonDashboard() {
  const { person, identity, token } = useSession();
  const bal = useAgentBalances(identity?.address);
  // The "Treasury USDC" tile reflects the person's MONEY agent (their treasury), detected from
  // the home vault — same source as /treasury — falling back to the person SA before one exists.
  const treas = usePersonTreasury(token);
  if (!person) return null;
  const treasuryUsdc = treas.exists ? treas.usdc : bal.usdc;
  const treasuryLoading = treas.loading || bal.loading;
  const orgs = person.custodyOf.map(orgById).filter(Boolean);
  const memberships = person.membershipIds.map(orgById).filter(Boolean);
  const hasOrgs = orgs.length + memberships.length > 0;

  return (
    <>
      <SectionHead eyebrow="Your home" title={`Peace be with you, ${person.pii.preferredName}`} sub={person.blurb} />

      {/* You card */}
      <div className="card card-pad card-hover" style={{ marginBottom: "1.2rem" }}>
        <div className="row" style={{ gap: "1rem", alignItems: "flex-start" }}>
          <Glyph kind="person" name={person.name} size="lg" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="row-between">
              <div>
                <div className="h2">{person.name}</div>
                <div className="row wrap" style={{ gap: ".4rem", marginTop: 4 }}>
                  <span className="addr">{person.agentName}</span>
                  <span className="addr">{person.address.slice(0, 8)}…{person.address.slice(-4)}</span>
                </div>
              </div>
              <Link href="/you" className="btn btn-ghost btn-sm">View profile</Link>
            </div>
            {person.trust && (
              <div style={{ marginTop: "1rem", maxWidth: 420 }}>
                <div className="row-between" style={{ marginBottom: 6 }}>
                  <span className="eyebrow">Agentic trust</span>
                  <strong>{Math.round(person.trust.overall * 100)}%</strong>
                </div>
                <TrustMeter value={person.trust.overall} />
                <div style={{ marginTop: ".7rem" }}><DimensionBadges trust={person.trust} /></div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Stats — treasury balance is read LIVE on-chain for the connected agent */}
      <div className="grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: "1.4rem" }}>
        <StatTile num={treasuryLoading ? "…" : `$${treasuryUsdc ?? "0.00"}`} label="Treasury USDC (live)" accent="var(--amber-700)" />
        <StatTile num={bal.loading ? "…" : `${bal.eth ?? "0"}`} label="ETH (live)" />
        <StatTile num={person.entitlements.length} label="Entitlements" />
        <StatTile num={orgs.length + memberships.length} label="Organizations" />
      </div>

      {/* What you steward */}
      <SectionHead title="What you steward" sub="Organizations you custody and the communities you belong to." />
      {!hasOrgs ? (
        <div style={{ marginBottom: "1.6rem" }}>
          <EmptyNote>
            <div style={{ marginBottom: ".7rem" }}>You haven&apos;t connected any organizations yet.</div>
            <Link href="/organizations" className="btn btn-primary btn-sm"><IconPlus width={15} height={15} /> Connect an organization</Link>
          </EmptyNote>
        </div>
      ) : (
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", marginBottom: "1.6rem" }}>
        {orgs.map((o) => o && (
          <Link key={o.id} href="/organizations" className="card card-pad card-hover">
            <div className="row" style={{ gap: ".8rem" }}>
              <Glyph kind="org" name={o.name} size="md" />
              <div style={{ flex: 1 }}>
                <div className="row-between">
                  <strong>{o.name}</strong>
                  <Pill tone="amber">custodian</Pill>
                </div>
                <div className="muted" style={{ fontSize: ".82rem" }}>{o.blurb}</div>
              </div>
            </div>
            <div className="row wrap" style={{ gap: ".4rem", marginTop: ".8rem" }}>
              <Pill tone="emerald">{servicesForOrg(o.id).length} service agents</Pill>
              <Pill>{o.memberIds.length} members</Pill>
            </div>
          </Link>
        ))}
        {memberships.map((o) => o && (
          <Link key={o.id} href="/organizations" className="card card-pad card-hover">
            <div className="row" style={{ gap: ".8rem" }}>
              <Glyph kind="org" name={o.name} size="md" />
              <div style={{ flex: 1 }}>
                <div className="row-between">
                  <strong>{o.name}</strong>
                  <Pill>member</Pill>
                </div>
                <div className="muted" style={{ fontSize: ".82rem" }}>{o.blurb}</div>
              </div>
            </div>
          </Link>
        ))}
      </div>
      )}

      {/* Quick links + activity */}
      <div className="grid" style={{ gridTemplateColumns: "1.3fr 1fr" }}>
        <div>
          <SectionHead title="Your home" />
          <div className="grid" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
            <QuickLink href="/vault" icon={<IconVault />} title="Vault" sub="PII, entitlements, delegations" />
            <QuickLink href="/treasury" icon={<IconWallet />} title="Treasury" sub="Balance & payment mandates" />
            <QuickLink href="/trust-graph" icon={<IconGraph />} title="Trust graph" sub="Your relationships, visualized" />
            <QuickLink href="/security" icon={<IconShield />} title="Security" sub="Keys, devices, sessions" />
          </div>
        </div>
        <div>
          <SectionHead title="Recent activity" />
          <div className="card card-pad col" style={{ gap: ".9rem" }}>
            <span className="muted" style={{ fontSize: ".86rem" }}>No activity yet — actions you take (granting permission, giving, attestations) will appear here.</span>
          </div>
        </div>
      </div>
    </>
  );
}

function OrgDashboard({ orgId }: { orgId: string }) {
  const org = orgById(orgId);
  if (!org) return null;
  const services = servicesForOrg(org.id);
  const recent = ACTIVITY.filter((a) => a.context === "org").slice(0, 4);

  return (
    <>
      <SectionHead eyebrow="Acting as custodian" title={org.name} sub={org.profile.mission} />

      <div className="card card-pad" style={{ marginBottom: "1.2rem" }}>
        <div className="row" style={{ gap: "1rem", alignItems: "flex-start" }}>
          <Glyph kind="org" name={org.name} size="lg" />
          <div style={{ flex: 1 }}>
            <div className="row wrap" style={{ gap: ".4rem" }}>
              <span className="addr">{org.agentName}</span>
              <Pill tone="emerald">{org.profile.sector}</Pill>
              {org.profile.location && <Pill>{org.profile.location}</Pill>}
            </div>
            {org.trust && (
              <div style={{ marginTop: "1rem", maxWidth: 440 }}>
                <div className="row-between" style={{ marginBottom: 6 }}>
                  <span className="eyebrow">Organization trust</span>
                  <strong>{Math.round(org.trust.overall * 100)}% · {org.trust.corroborations} corroborations</strong>
                </div>
                <TrustMeter value={org.trust.overall} />
                <div style={{ marginTop: ".7rem" }}><DimensionBadges trust={org.trust} /></div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: "1.4rem" }}>
        <StatTile num={`$${org.treasury.balanceUsdc.toLocaleString()}`} label="Org treasury (USDC)" accent="var(--emerald-700)" />
        <StatTile num={services.length} label="Service agents" accent="var(--plum-600)" />
        <StatTile num={org.memberIds.length} label="Members" />
        <StatTile num={org.attestations.length} label="Partner attestations" />
      </div>

      <SectionHead title="Service smart agents" sub="The agents this organization manages — the trust graph applies to these." action={<Link href="/service-agents" className="btn btn-ghost btn-sm">Manage all</Link>} />
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", marginBottom: "1.6rem" }}>
        {services.map((s) => (
          <Link key={s.id} href="/service-agents" className="card card-pad card-hover">
            <div className="row" style={{ gap: ".7rem" }}>
              <Glyph kind="service" name={s.name} size="md" />
              <div style={{ flex: 1 }}>
                <strong>{s.name}</strong>
                <div className="muted" style={{ fontSize: ".8rem" }}>{s.blurb}</div>
              </div>
            </div>
            <div className="row wrap" style={{ gap: ".4rem", marginTop: ".7rem" }}>
              <Pill tone="plum">{s.role}</Pill>
              <Pill>{s.skills.filter((k) => k.enabled).length}/{s.skills.length} skills live</Pill>
            </div>
          </Link>
        ))}
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1.2fr 1fr" }}>
        <div>
          <SectionHead title="Partner trust" sub="Corroborated assertions binding this org to others." />
          <div className="card card-pad col" style={{ gap: ".8rem" }}>
            {org.attestations.map((a) => (
              <div key={a.id} className="row-between" style={{ alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontSize: ".88rem" }}><strong>{a.by}</strong> — {a.statement}</div>
                  <div className="faint" style={{ fontSize: ".72rem" }}>
                    {new Date(a.at).getFullYear()}{a.basis ? ` · basis ${a.basis}` : ""}
                  </div>
                </div>
                <Pill tone={a.confidence >= 0.99 ? "emerald" : "amber"}>
                  conf {a.confidence.toFixed(2)}
                </Pill>
              </div>
            ))}
            {org.attestations.length === 0 && <span className="muted">No attestations yet.</span>}
          </div>
        </div>
        <div>
          <SectionHead title="Recent activity" />
          <div className="card card-pad col" style={{ gap: ".9rem" }}>
            {recent.map((a) => (
              <div key={a.id} className="row" style={{ gap: ".7rem", alignItems: "flex-start" }}>
                <span className="dot" style={{ color: "var(--emerald-500)", marginTop: 7 }} />
                <div>
                  <div style={{ fontSize: ".88rem" }}><strong>{a.actor}</strong> {a.verb} {a.object}</div>
                  <div className="faint" style={{ fontSize: ".72rem" }}>{new Date(a.at).toLocaleDateString()}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function QuickLink({ href, icon, title, sub }: { href: string; icon: React.ReactNode; title: string; sub: string }) {
  return (
    <Link href={href} className="card card-pad card-hover row" style={{ gap: ".8rem" }}>
      <div className="glyph glyph-sm" style={{ background: "var(--surface-sunken)", color: "var(--amber-700)" }}>{icon}</div>
      <div>
        <strong style={{ fontSize: ".94rem" }}>{title}</strong>
        <div className="muted" style={{ fontSize: ".78rem" }}>{sub}</div>
      </div>
    </Link>
  );
}
