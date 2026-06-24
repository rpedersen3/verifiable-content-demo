// Builds the node/edge sets for the React Flow trust graph from seed data.
// Two views: a person-centric "my relationships" view and an org-centric
// "organization trust graph" view (the builder a custodian uses).

import {
  EDGES,
  ORGS,
  PEERS,
  PERSON,
  SERVICES,
  orgById,
  serviceById,
  servicesForOrg,
} from "./seed";
import { EDGE_CLASS, type AgentKind, type EdgeClass, type EdgeKind, type TrustEdge } from "./types";

/** A node kind, plus the synthetic "custodian" (the connected human controlling a SA). */
export type GNodeKind = AgentKind | "custodian";

/** The connected human custodian, shown distinctly from the smart agents. */
export const CUSTODIAN_ID = "custodian:you";

export interface GNode {
  id: string;
  position: { x: number; y: number };
  data: { refId: string; kind: GNodeKind; name: string; sub: string; trust?: number; focus?: boolean };
}
export interface GEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  label: string;
  weight: number;
}

export interface GView {
  nodes: GNode[];
  edges: GEdge[];
}

interface Meta {
  kind: GNodeKind;
  name: string;
  sub: string;
  trust?: number;
}

export function nodeMeta(id: string): Meta {
  if (id === CUSTODIAN_ID) return { kind: "custodian", name: "You", sub: "passkey custodian" };
  if (id === PERSON.id) return { kind: "person", name: PERSON.name, sub: PERSON.agentName, trust: PERSON.trust?.overall };
  const o = orgById(id);
  if (o) return { kind: "org", name: o.name, sub: o.profile.sector, trust: o.trust?.overall };
  const s = serviceById(id);
  if (s) return { kind: "service", name: s.name, sub: s.role, trust: s.trust?.overall };
  const p = PEERS.find((x) => x.id === id);
  if (p) return { kind: "person", name: p.name, sub: p.blurb ?? p.agentName };
  return { kind: "person", name: id, sub: "" };
}

function spread(count: number, mid: number, gap: number): number[] {
  const start = mid - ((count - 1) * gap) / 2;
  return Array.from({ length: count }, (_, i) => start + i * gap);
}

function mkNode(id: string, x: number, y: number, focus = false): GNode {
  const m = nodeMeta(id);
  return { id, position: { x, y }, data: { refId: id, ...m, focus } };
}

function edgesWithin(ids: Set<string>): GEdge[] {
  return EDGES.filter((e) => ids.has(e.from) && ids.has(e.to)).map(toGEdge);
}
function toGEdge(e: TrustEdge): GEdge {
  return { id: e.id, source: e.from, target: e.to, kind: e.kind, label: e.label, weight: e.weight };
}

/** The custody/control edge: the connected human → their person Smart Agent.
 *  The ONLY edge crossing the human↔agent boundary; never between two agents. */
function controlEdge(): GEdge {
  return { id: "e:control-you", source: CUSTODIAN_ID, target: PERSON.id, kind: "control", label: "holds keys", weight: 1 };
}

// ── Person view ───────────────────────────────────────────────────────────────
export function buildPersonGraph(): GView {
  const orgs = [...PERSON.custodyOf, ...PERSON.membershipIds];
  const services = PERSON.custodyOf.flatMap((oid) => servicesForOrg(oid).map((s) => s.id));

  // The connected human custodian sits ABOVE the person SA they control — visually
  // off the agent-to-agent plane where all the authority edges live.
  const nodes: GNode[] = [
    mkNode(CUSTODIAN_ID, 70, 90),
    mkNode(PERSON.id, 70, 360, true),
  ];
  spread(orgs.length, 360, 230).forEach((y, i) => nodes.push(mkNode(orgs[i]!, 430, y)));
  spread(services.length, 360, 130).forEach((y, i) => nodes.push(mkNode(services[i]!, 800, y)));

  const ids = new Set(nodes.map((n) => n.id));
  return { nodes, edges: [controlEdge(), ...edgesWithin(ids)] };
}

// ── Org-centric view (the trust-graph builder) ──────────────────────────────────
export function buildOrgGraph(orgId: string): GView {
  const org = orgById(orgId);
  if (!org) return { nodes: [], edges: [] };

  const services = servicesForOrg(orgId).map((s) => s.id);
  const people = Array.from(new Set([...org.custodians, ...org.memberIds]));
  // partner orgs = any org connected to focus by an assertion/payment edge
  const partners = Array.from(
    new Set(
      EDGES.filter(
        (e) => (e.kind === "assertion" || e.kind === "payment") && (e.from === orgId || e.to === orgId),
      )
        .map((e) => (e.from === orgId ? e.to : e.from))
        .filter((id) => orgById(id)),
    ),
  );

  const nodes: GNode[] = [mkNode(orgId, 440, 310, true)];
  spread(services.length, 300, 140).forEach((y, i) => nodes.push(mkNode(services[i]!, 820, y)));
  const peopleY = spread(people.length, 320, 150);
  peopleY.forEach((y, i) => nodes.push(mkNode(people[i]!, 70, y)));
  spread(partners.length, 470, 240).forEach((x, i) => nodes.push(mkNode(partners[i]!, x, 60)));

  // If the connected human's own SA is in this org, show them as its custodian —
  // off to the side of the agent plane, controlling only their person SA.
  const extraEdges: GEdge[] = [];
  const graceIdx = people.indexOf(PERSON.id);
  if (graceIdx >= 0) {
    nodes.push(mkNode(CUSTODIAN_ID, -160, peopleY[graceIdx]!));
    extraEdges.push(controlEdge());
  }

  const ids = new Set(nodes.map((n) => n.id));
  return { nodes, edges: [...extraEdges, ...edgesWithin(ids)] };
}

export interface EdgeStyle {
  color: string;
  dashed: boolean;
  /** finely dotted — reserved for the control/custody class so it reads as "not authority". */
  dotted?: boolean;
  label: string;
  cls: EdgeClass;
}

export const EDGE_KIND_STYLE: Record<EdgeKind, EdgeStyle> = {
  // Control / custody — human → agent. Deliberately muted + dotted so it never
  // competes with (or looks like) authority between agents.
  control: { color: "#64748b", dashed: true, dotted: true, label: "Holds keys (you → your agent)", cls: "control" },
  // Authority & trust — agent → agent. Saturated, weighted, the focus of the graph.
  delegation: { color: "#7c3aed", dashed: true, label: "Delegation", cls: "authority" },
  entitlement: { color: "#0891b2", dashed: false, label: "Entitlement", cls: "authority" },
  stewardship: { color: "#d97706", dashed: false, label: "Stewardship", cls: "authority" },
  membership: { color: "#a8a29e", dashed: false, label: "Membership", cls: "authority" },
  assertion: { color: "#10b981", dashed: false, label: "Trust assertion", cls: "authority" },
  payment: { color: "#f59e0b", dashed: true, label: "Payment mandate", cls: "authority" },
};

export { EDGE_CLASS };

export const NODE_KIND_LABEL: Record<GNodeKind, string> = {
  custodian: "You (custodian)",
  person: "Person agent",
  org: "Organization agent",
  service: "Service agent",
};

export { ORGS, SERVICES };
