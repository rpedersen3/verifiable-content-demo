"use client";

import { useState } from "react";
import { useSession } from "@/context/session";
import { orgById } from "@/lib/seed";
import { SectionHead } from "@/components/ui";
import TrustGraph from "@/components/graph/TrustGraph";

type View = { mode: "person" } | { mode: "org"; orgId: string };

export default function TrustGraphPage() {
  const { person, active } = useSession();
  const initial: View =
    active.mode === "org" ? { mode: "org", orgId: active.orgId } : { mode: "person" };
  const [view, setView] = useState<View>(initial);
  if (!person) return null;

  const custodyOrgs = person.custodyOf.map(orgById).filter(Boolean);
  const isPerson = view.mode === "person";

  return (
    <>
      <SectionHead
        eyebrow="Agentic trust"
        title="Trust graph"
        sub="Your relationships as a web of provenance-grounded trust. Switch to an organization to build and inspect its trust graph across members, service agents, and partners."
      />

      {/* Two relationship classes, kept visually distinct */}
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: ".8rem", marginBottom: "1rem" }}>
        <div className="card card-pad" style={{ borderLeft: "3px dashed var(--border-strong)" }}>
          <div className="eyebrow" style={{ color: "var(--text-faint)" }}>Control · custody</div>
          <div style={{ fontSize: ".86rem", marginTop: 4 }}>
            <strong>You → your agent.</strong> The human custodian holds the keys to their person
            agent. A control link — not authority — shown dotted &amp; muted, crossing the
            person↔agent line only once.
          </div>
        </div>
        <div className="card card-pad" style={{ borderLeft: "3px solid var(--amber-500)" }}>
          <div className="eyebrow">Authority &amp; trust · agent → agent</div>
          <div style={{ fontSize: ".86rem", marginTop: 4 }}>
            <strong>Between smart agents.</strong> Delegations, entitlements, stewardship,
            membership, payment mandates &amp; trust assertions — drawn bold and weighted. This is
            where the trust graph is built.
          </div>
        </div>
      </div>

      {/* View toggle */}
      <div className="row wrap" style={{ gap: ".5rem", marginBottom: "1rem" }}>
        <button
          className={`btn btn-sm ${isPerson ? "btn-primary" : "btn-ghost"}`}
          onClick={() => setView({ mode: "person" })}
        >
          My relationships
        </button>
        {custodyOrgs.map((o) => o && (
          <button
            key={o.id}
            className={`btn btn-sm ${!isPerson && view.mode === "org" && view.orgId === o.id ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setView({ mode: "org", orgId: o.id })}
          >
            {o.name} · trust graph
          </button>
        ))}
      </div>

      <div
        className="card"
        style={{ height: "min(72vh, 720px)", overflow: "hidden", padding: 0 }}
      >
        <TrustGraph
          view={view.mode}
          orgId={view.mode === "org" ? view.orgId : undefined}
        />
      </div>

      <p className="faint" style={{ fontSize: ".78rem", marginTop: ".9rem" }}>
        Tip: click any node to inspect its trust dimensions, skills, and attestations. Drag to rearrange.
        Edge confidence and corroboration come from the seed graph; live attestations bind from the
        org trust agent in a later phase.
      </p>
    </>
  );
}
