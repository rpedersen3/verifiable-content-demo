"use client";

import { useState } from "react";
import Link from "next/link";
import { useSession } from "@/context/session";
import { orgById, servicesForOrg } from "@/lib/seed";
import { Glyph, SectionHead, Pill, TrustMeter, DimensionBadges } from "@/components/ui";
import { IconPlus, IconSpark } from "@/components/Icons";
import type { ServiceAgent } from "@/lib/types";

export default function ServiceAgentsPage() {
  const { active } = useSession();
  if (active.mode !== "org") {
    return (
      <div className="card card-pad" style={{ textAlign: "center", padding: "2.5rem" }}>
        <div className="h2" style={{ marginBottom: ".5rem" }}>Switch into a custodian context</div>
        <p className="muted" style={{ marginBottom: "1rem" }}>Service smart agents belong to an organization you steward.</p>
        <Link href="/organizations" className="btn btn-primary btn-sm">Choose an organization</Link>
      </div>
    );
  }
  const org = orgById(active.orgId);
  if (!org) return null;
  const services = servicesForOrg(org.id);

  return (
    <>
      <SectionHead
        eyebrow="Service smart agents"
        title="Service agents"
        sub={`${org.name} manages these service agents. Each exposes skills over A2A — and the trust graph applies to them. The organization's trust agent is itself a service agent.`}
        action={<button className="btn btn-primary btn-sm"><IconPlus width={15} height={15} /> New service agent</button>}
      />
      <div className="col" style={{ gap: "1rem" }}>
        {services.map((s) => <ServiceCard key={s.id} svc={s} />)}
      </div>
    </>
  );
}

function ServiceCard({ svc }: { svc: ServiceAgent }) {
  const [skills, setSkills] = useState(svc.skills);
  const toggle = (id: string) =>
    setSkills((ks) => ks.map((k) => (k.id === id ? { ...k, enabled: !k.enabled } : k)));

  return (
    <div className="card card-pad">
      <div className="row-between" style={{ alignItems: "flex-start" }}>
        <div className="row" style={{ gap: ".8rem" }}>
          <Glyph kind="service" name={svc.name} size="md" />
          <div>
            <div className="row" style={{ gap: ".5rem" }}>
              <strong>{svc.name}</strong>
              <Pill tone="plum">{svc.role === "trust" ? "★ trust agent" : svc.role}</Pill>
            </div>
            <div className="muted" style={{ fontSize: ".82rem" }}>{svc.blurb}</div>
            <code className="mono faint" style={{ fontSize: ".72rem" }}>{svc.agentName}</code>
          </div>
        </div>
        {svc.trust && (
          <div style={{ width: 180 }}>
            <div className="row-between" style={{ marginBottom: 4 }}>
              <span className="faint" style={{ fontSize: ".72rem" }}>trust</span>
              <strong style={{ fontSize: ".82rem" }}>{Math.round(svc.trust.overall * 100)}%</strong>
            </div>
            <TrustMeter value={svc.trust.overall} />
          </div>
        )}
      </div>

      {svc.trust && <div style={{ marginTop: ".8rem" }}><DimensionBadges trust={svc.trust} /></div>}

      <div className="hr" />
      <div className="eyebrow" style={{ marginBottom: ".6rem" }}>
        <IconSpark width={13} height={13} style={{ verticalAlign: "-2px" }} /> Exposed skills
      </div>
      <div className="col" style={{ gap: ".5rem" }}>
        {skills.map((k) => (
          <div key={k.id} className="row-between" style={{ padding: ".55rem .7rem", background: "var(--surface-sunken)", borderRadius: "var(--r-md)" }}>
            <div style={{ flex: 1 }}>
              <div className="row" style={{ gap: ".5rem" }}>
                <strong style={{ fontSize: ".88rem" }}>{k.name}</strong>
                <code className="mono faint" style={{ fontSize: ".7rem" }}>{k.a2aId}</code>
              </div>
              <div className="muted" style={{ fontSize: ".8rem" }}>{k.description}</div>
              <div className="row wrap" style={{ gap: ".35rem", marginTop: ".35rem" }}>
                <Pill>{k.scope}</Pill>
                {k.priceUsdc > 0 ? <Pill tone="amber">${k.priceUsdc}/call</Pill> : <Pill tone="emerald">free</Pill>}
                <Pill>{k.callsThisMonth} calls/mo</Pill>
              </div>
            </div>
            <button
              className={`btn btn-sm ${k.enabled ? "btn-primary" : "btn-ghost"}`}
              onClick={() => toggle(k.id)}
            >
              {k.enabled ? "Live" : "Off"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
