"use client";

import { useSession } from "@/context/session";
import { Glyph, SectionHead, TrustMeter, DimensionBadges, classBadge, Pill } from "@/components/ui";

export default function YouPage() {
  const { person } = useSession();
  if (!person) return null;
  const pii = person.pii;
  const fields: { key: string; label: string; value?: string }[] = [
    { key: "legalName", label: "Legal name", value: pii.legalName },
    { key: "preferredName", label: "Preferred name", value: pii.preferredName },
    { key: "email", label: "Email", value: pii.email },
    { key: "phone", label: "Phone", value: pii.phone },
    { key: "congregation", label: "Congregation", value: pii.congregation },
    { key: "location", label: "Location", value: pii.location },
  ];

  return (
    <>
      <SectionHead eyebrow="Your identity" title="You" sub="Your person agent and how your identity is shared. You decide what's visible." />

      <div className="card card-pad" style={{ marginBottom: "1.2rem" }}>
        <div className="row" style={{ gap: "1rem" }}>
          <Glyph kind="person" name={person.name} size="lg" />
          <div style={{ flex: 1 }}>
            <div className="h2">{person.name}</div>
            <div className="row wrap" style={{ gap: ".4rem", marginTop: 6 }}>
              <span className="addr">{person.agentName}</span>
              <span className="addr">{person.address}</span>
              <Pill tone="emerald">deployed</Pill>
            </div>
          </div>
        </div>
        {person.trust && (
          <div style={{ marginTop: "1.2rem", maxWidth: 460 }}>
            <div className="row-between" style={{ marginBottom: 6 }}>
              <span className="eyebrow">Agentic trust · {person.trust.corroborations} corroborations</span>
              <strong>{Math.round(person.trust.overall * 100)}%</strong>
            </div>
            <TrustMeter value={person.trust.overall} />
            <div style={{ marginTop: ".7rem" }}><DimensionBadges trust={person.trust} /></div>
          </div>
        )}
      </div>

      <SectionHead title="Profile & visibility" sub="Each field's classification controls who can read it through a delegation." />
      <div className="card" style={{ overflow: "hidden" }}>
        {fields.filter((f) => f.value).map((f, i) => (
          <div
            key={f.key}
            className="row-between"
            style={{ padding: "0.9rem 1.2rem", borderTop: i ? "1px solid var(--border)" : undefined }}
          >
            <div>
              <div className="faint" style={{ fontSize: ".72rem" }}>{f.label}</div>
              <div style={{ fontWeight: 550 }}>{f.value}</div>
            </div>
            {classBadge(pii.visibility[f.key] ?? "public")}
          </div>
        ))}
      </div>

      <p className="faint" style={{ fontSize: ".78rem", marginTop: "1rem" }}>
        This profile lives in your vault as <code className="mono">person:pii</code>, encrypted at rest.
        Editing & the live vault write ceremony wire to impact-mcp in a later phase.
      </p>
    </>
  );
}
