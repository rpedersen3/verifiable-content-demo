// ============================================================================
// Impact domain model
// ----------------------------------------------------------------------------
// Three agent kinds form the trust graph:
//   - person   : a member's own Smart Agent (root custodian of their home)
//   - org       : an organization Smart Agent (a person is its custodian)
//   - service   : a service Smart Agent managed by an org and exposing skills.
//                 An organization's "trust agent" is just one kind of service.
// Trust is multi-dimensional & provenance-grounded — never a single number we
// silently trust. Identity-match confidence is kept separate from entity-trust.
// ============================================================================

export type AgentKind = "person" | "org" | "service";

export type Address = `0x${string}`;

/** The five trust dimensions surfaced across the UI (see CLAUDE.md trust ontology). */
export type TrustDimension =
  | "moral"
  | "graph"
  | "scriptural"
  | "historical"
  | "source";

export interface TrustScore {
  /** 0..1 overall, derived (a gc:Assessment) — never treated as settled fact. */
  overall: number;
  dimensions: Partial<Record<TrustDimension, number>>;
  /** how many independent, authoritative sources corroborate this entity. */
  corroborations: number;
}

export interface Attestation {
  id: string;
  /** who asserted it (a dns:Assertion source). */
  by: string;
  statement: string;
  /** ISO date. */
  at: string;
  /** stable id the assertion agreed on, if any (Wikidata/GeoNames/…). */
  basis?: string;
  confidence: number; // 0..1
}

export interface AgentRef {
  id: string;
  kind: AgentKind;
  /** human handle e.g. "grace" → grace.impact */
  handle: string;
  /** display name */
  name: string;
  address: Address;
  /** the .impact agent name */
  agentName: string;
  blurb?: string;
  deployed: boolean;
  trust?: TrustScore;
}

// ── Vault ────────────────────────────────────────────────────────────────────

export type VaultClass = "public" | "sensitive" | "restricted";

export interface PiiProfile {
  legalName: string;
  preferredName: string;
  email: string;
  phone?: string;
  congregation?: string;
  location?: string;
  /** what is shared vs held back, by field. */
  visibility: Record<string, VaultClass>;
}

export interface Entitlement {
  id: string;
  title: string;
  issuer: string;
  scope: string;
  status: "active" | "expired" | "pending";
  grantedAt: string;
  expiresAt?: string;
}

export type DelegationDirection = "given" | "received";

export interface Delegation {
  id: string;
  direction: DelegationDirection;
  /** counterparty handle */
  counterparty: string;
  counterpartyKind: AgentKind;
  /** plain-language scope */
  canDo: string[];
  cannotDo: string[];
  grantedAt: string;
  expiresAt?: string;
  /** value cap in USDC if a payment mandate, else 0 */
  valueCapUsdc: number;
  revocable: boolean;
}

export interface VaultRecord {
  type: string;
  label: string;
  class: VaultClass;
  updatedAt: string;
  summary: string;
}

// ── Treasury ──────────────────────────────────────────────────────────────────

export interface PaymentMandate {
  id: string;
  payee: string;
  kind: "pay-as-you-go" | "subscription";
  capUsdc: number;
  spentUsdc: number;
  period?: string;
  nextChargeAt?: string;
}

export interface Treasury {
  ownerId: string;
  address: Address;
  balanceUsdc: number;
  mandates: PaymentMandate[];
}

// ── Skills (exposed by service agents) ─────────────────────────────────────────

export interface Skill {
  id: string;
  name: string;
  description: string;
  /** A2A skill id surfaced on the agent card */
  a2aId: string;
  priceUsdc: number; // 0 = free
  scope: string;
  enabled: boolean;
  callsThisMonth: number;
}

// ── Organizations & service agents ──────────────────────────────────────────────

export interface OrgProfile {
  displayName: string;
  mission: string;
  website?: string;
  contactEmail?: string;
  location?: string;
  sector: string;
}

export interface ServiceAgent extends AgentRef {
  kind: "service";
  /** owning org id */
  orgId: string;
  /** the org trust agent is a service of role "trust"; others vary */
  role: "trust" | "benevolence" | "media" | "events" | "giving" | "directory";
  skills: Skill[];
}

export interface Organization extends AgentRef {
  kind: "org";
  profile: OrgProfile;
  /** person ids who custody this org */
  custodians: string[];
  /** person ids who are members */
  memberIds: string[];
  treasury: Treasury;
  serviceAgentIds: string[];
  attestations: Attestation[];
}

export interface Person extends AgentRef {
  kind: "person";
  pii: PiiProfile;
  treasury: Treasury;
  entitlements: Entitlement[];
  delegations: Delegation[];
  vaultRecords: VaultRecord[];
  /** orgs this person belongs to / can act for */
  membershipIds: string[];
  /** orgs this person is a custodian of */
  custodyOf: string[];
  /** the org id chosen as the active default org context (or null = person-only) */
  defaultOrgId: string | null;
  attestations: Attestation[];
}

// ── Trust graph ────────────────────────────────────────────────────────────────

// Two distinct relationship CLASSES, kept visually separate everywhere:
//
//  • CONTROL/CUSTODY — a human custodian controls a smart agent (holds its keys).
//    This is the only edge that crosses the human↔agent boundary. It is NOT
//    authority and never appears between two smart agents.
//
//  • AUTHORITY & TRUST — everything BETWEEN smart agents: delegation,
//    entitlements, stewardship, membership, payment mandates, and trust
//    assertions. This is where the trust graph is actually built.
export type EdgeClass = "control" | "authority";

export type EdgeKind =
  | "control" // custodian (human) → person SA — custody/control of keys
  | "delegation" // SA → SA — scoped authority (ERC-7710 leaf)
  | "entitlement" // SA → SA — a granted credential/capability
  | "stewardship" // SA → SA — an agent manages/stewards another (org → service, person → org)
  | "membership" // person SA → org SA — belongs to
  | "assertion" // org/person SA → org SA — trust attestation / corroboration
  | "payment"; // treasury SA → payee SA — payment mandate

export const EDGE_CLASS: Record<EdgeKind, EdgeClass> = {
  control: "control",
  delegation: "authority",
  entitlement: "authority",
  stewardship: "authority",
  membership: "authority",
  assertion: "authority",
  payment: "authority",
};

export interface TrustEdge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  label: string;
  /** 0..1 strength used for edge weight / styling */
  weight: number;
  /** identity-match confidence for any brought-in binding (separate from trust). */
  canonConfidence?: number;
  canonMethod?: string;
}

export interface ActivityEvent {
  id: string;
  at: string;
  actor: string;
  verb: string;
  object: string;
  context: "person" | "org";
}
