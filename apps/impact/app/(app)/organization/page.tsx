"use client";

import Link from "next/link";
import { useSession } from "@/context/session";
import { orgById, PERSON, PEERS } from "@/lib/seed";
import { Glyph, SectionHead, Pill } from "@/components/ui";
import { orgHref } from "@/lib/workspace";

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
    const liveName = active.live ? (active.live.name ?? "This organization") : "This organization";
    return (
      <div className="card card-pad" style={{ textAlign: "center", padding: "2.5rem" }}>
        <div className="h2" style={{ marginBottom: ".5rem" }}>{liveName}</div>
        <p className="muted" style={{ marginBottom: "1rem" }}>
          This is a live on-chain organization you steward. Its public profile (mission, sector, members) isn&apos;t
          set up yet — for now, manage its encrypted records in the <Link href={orgHref(active.orgId, "vault")}>organization vault</Link>.
        </p>
        <Link href={orgHref(active.orgId, "vault")} className="btn btn-primary btn-sm">Open the organization vault</Link>
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
