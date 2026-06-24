// Shared presentational primitives.
import type { ReactNode } from "react";
import type { AgentKind, TrustDimension, TrustScore } from "@/lib/types";

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

const glyphClass: Record<AgentKind | "custodian", string> = {
  person: "glyph-person",
  org: "glyph-org",
  service: "glyph-service",
  custodian: "glyph-custodian",
};

export function Glyph({
  kind,
  name,
  size = "md",
}: {
  kind: AgentKind | "custodian";
  name: string;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <div className={`glyph glyph-${size} ${glyphClass[kind]}`} aria-hidden>
      {initials(name)}
    </div>
  );
}

export function SectionHead({
  eyebrow,
  title,
  sub,
  action,
}: {
  eyebrow?: string;
  title: string;
  sub?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-head">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1 className="h1" style={{ marginTop: eyebrow ? 4 : 0 }}>
          {title}
        </h1>
        {sub && <p className="muted" style={{ marginTop: 6, maxWidth: 560 }}>{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export function StatTile({ num, label, accent }: { num: ReactNode; label: string; accent?: string }) {
  return (
    <div className="card stat">
      <div className="num" style={accent ? { color: accent } : undefined}>{num}</div>
      <div className="muted" style={{ fontSize: ".82rem", marginTop: 2 }}>{label}</div>
    </div>
  );
}

export function TrustMeter({ value }: { value: number }) {
  return (
    <div className="meter" aria-label={`trust ${Math.round(value * 100)}%`}>
      <span style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}

const dimColor: Record<TrustDimension, string> = {
  moral: "var(--dim-moral)",
  graph: "var(--dim-graph)",
  scriptural: "var(--dim-scriptural)",
  historical: "var(--dim-historical)",
  source: "var(--dim-source)",
};

export function DimensionBadges({ trust }: { trust: TrustScore }) {
  const dims = Object.entries(trust.dimensions) as [TrustDimension, number][];
  return (
    <div className="row wrap" style={{ gap: ".4rem" }}>
      {dims.map(([d, v]) => (
        <span key={d} className="chip" title={`${d}: ${Math.round(v * 100)}%`}>
          <span className="dot" style={{ color: dimColor[d] }} />
          {d} · {Math.round(v * 100)}
        </span>
      ))}
    </div>
  );
}

export function Pill({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "amber" | "emerald" | "plum" | "danger" }) {
  return <span className={`chip ${tone === "default" ? "" : `chip-${tone}`}`}>{children}</span>;
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <div className="card card-pad muted" style={{ textAlign: "center", padding: "2rem" }}>
      {children}
    </div>
  );
}

export function classBadge(cls: string) {
  if (cls === "restricted") return <Pill tone="danger">restricted</Pill>;
  if (cls === "sensitive") return <Pill tone="amber">sensitive</Pill>;
  return <Pill tone="emerald">public</Pill>;
}
