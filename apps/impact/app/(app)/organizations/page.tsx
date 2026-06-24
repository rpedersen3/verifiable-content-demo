"use client";

import { useRouter } from "next/navigation";
import { useSession } from "@/context/session";
import { orgById, servicesForOrg } from "@/lib/seed";
import { Glyph, SectionHead, Pill, TrustMeter } from "@/components/ui";
import { IconPlus } from "@/components/Icons";
import type { Organization } from "@/lib/types";

export default function OrganizationsPage() {
  const { person, setActive, setDefaultOrg, defaultOrgId } = useSession();
  const router = useRouter();
  if (!person) return null;

  const custody = person.custodyOf.map(orgById).filter(Boolean) as Organization[];
  const member = person.membershipIds.map(orgById).filter(Boolean) as Organization[];

  function enterAsCustodian(orgId: string) {
    setActive({ mode: "org", orgId });
    router.push("/home");
  }

  return (
    <>
      <SectionHead
        eyebrow="Organizations"
        title="Organizations"
        sub="The communities you steward and belong to. Switch into a custodian context to manage one, or pin it as your default home."
        action={<button className="btn btn-ghost btn-sm"><IconPlus width={15} height={15} /> Connect an org</button>}
      />

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
