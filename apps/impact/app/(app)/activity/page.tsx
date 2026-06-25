"use client";

import { useSession } from "@/context/session";
import { ACTIVITY, orgById } from "@/lib/seed";
import { SectionHead, Pill } from "@/components/ui";

export default function ActivityPage() {
  const { active } = useSession();
  const isOrg = active.mode === "org";
  const subject = isOrg
    ? (active.live ? (active.live.name ?? "this organization") : orgById(active.orgId)?.name)
    : "you";
  const events = isOrg ? ACTIVITY.filter((a) => a.context === "org") : ACTIVITY;

  return (
    <>
      <SectionHead eyebrow="Activity" title="Activity" sub={`A provenance-grounded log of what happened around ${subject}.`} />
      <div className="card" style={{ overflow: "hidden" }}>
        {events.map((a, i) => (
          <div key={a.id} className="row" style={{ gap: ".9rem", padding: "1rem 1.2rem", borderTop: i ? "1px solid var(--border)" : undefined, alignItems: "flex-start" }}>
            <span className="dot" style={{ color: a.context === "org" ? "var(--emerald-500)" : "var(--amber-500)", marginTop: 8 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: ".9rem" }}><strong>{a.actor}</strong> {a.verb} {a.object}</div>
              <div className="faint" style={{ fontSize: ".74rem", marginTop: 2 }}>{new Date(a.at).toLocaleString()}</div>
            </div>
            <Pill tone={a.context === "org" ? "emerald" : "amber"}>{a.context}</Pill>
          </div>
        ))}
      </div>
    </>
  );
}
