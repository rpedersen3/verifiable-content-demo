"use client";

import { useState } from "react";
import Link from "next/link";
import { useSession } from "@/context/session";
import { orgById } from "@/lib/seed";
import { SectionHead, Glyph } from "@/components/ui";
import { IconPlus } from "@/components/Icons";
import TrustGraph from "@/components/graph/TrustGraph";

type View = { mode: "person" } | { mode: "org"; orgId: string };

export default function TrustGraphPage() {
  const { person, identity, active } = useSession();
  const initial: View =
    active.mode === "org" ? { mode: "org", orgId: active.orgId } : { mode: "person" };
  const [view, setView] = useState<View>(initial);
  if (!person) return null;

  const custodyOrgs = person.custodyOf.map(orgById).filter(Boolean);
  const isPerson = view.mode === "person";
  const noRelationships = person.custodyOf.length === 0 && person.membershipIds.length === 0;

  // A freshly connected agent has no authority edges yet — show the real (minimal)
  // shape (you → your agent) instead of someone else's seeded graph.
  if (noRelationships) {
    return (
      <>
        <SectionHead eyebrow="Agentic trust" title="Trust graph" sub="Your relationships as a web of provenance-grounded trust." />
        <div className="card card-pad" style={{ textAlign: "center", padding: "2.5rem 1.5rem" }}>
          <div className="row" style={{ justifyContent: "center", gap: ".6rem", marginBottom: "1.2rem", alignItems: "center" }}>
            <Glyph kind="custodian" name="You" size="md" />
            <span style={{ borderTop: "2px dotted var(--border-strong)", width: 48, display: "inline-block" }} />
            <Glyph kind="person" name={person.name} size="md" />
          </div>
          <div className="h3" style={{ marginBottom: ".4rem" }}>It&apos;s just you and your agent so far</div>
          <p className="muted" style={{ maxWidth: 460, margin: "0 auto 1.2rem" }}>
            You hold the keys to <strong>{identity?.name ?? person.agentName}</strong> (a control relationship).
            Your trust graph grows with <strong>authority between smart agents</strong> — connect an
            organization, grant a delegation, or stand up a service agent.
          </p>
          <Link href="/organizations" className="btn btn-primary btn-sm"><IconPlus width={15} height={15} /> Connect an organization</Link>
        </div>
      </>
    );
  }

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
