// ============================================================================
// Seed data — a realistic faith-community trust graph for the redesigned UI.
// Phase 1 renders entirely from this; ceremonies (sign / vault / pay) are stubbed
// and wired to the live impact-a2a / impact-mcp backends in a later phase.
// ============================================================================

import type {
  ActivityEvent,
  Address,
  Organization,
  Person,
  ServiceAgent,
  TrustEdge,
} from "./types";

const addr = (s: string): Address => s as Address;

// ── The signed-in member ──────────────────────────────────────────────────────
export const PERSON: Person = {
  id: "person:grace",
  kind: "person",
  handle: "grace",
  name: "Grace Okonkwo",
  address: addr("0x15F7a2C4b09E3d8f1A6b7C2e0D4a9F3b8C1d2E5a"),
  agentName: "grace.impact",
  blurb: "Steward at Cornerstone Fellowship · member, City Mission Network",
  deployed: true,
  defaultOrgId: null,
  membershipIds: ["org:citymission"],
  custodyOf: ["org:cornerstone"],
  trust: {
    overall: 0.92,
    dimensions: { moral: 0.95, graph: 0.88, historical: 0.9, source: 0.94 },
    corroborations: 4,
  },
  pii: {
    legalName: "Grace Adaeze Okonkwo",
    preferredName: "Grace",
    email: "grace@cornerstone.faith",
    phone: "+1 (312) 555-0148",
    congregation: "Cornerstone Fellowship",
    location: "Chicago, IL",
    visibility: {
      legalName: "restricted",
      preferredName: "public",
      email: "sensitive",
      phone: "restricted",
      congregation: "public",
      location: "sensitive",
    },
  },
  treasury: {
    ownerId: "person:grace",
    address: addr("0x9A3fE71b2C8d04A5f6B1c9D2e3F4a5B6c7D8e9F0"),
    balanceUsdc: 240.0,
    mandates: [
      {
        id: "pm:tithe",
        payee: "Cornerstone Giving Agent",
        kind: "subscription",
        capUsdc: 50,
        spentUsdc: 150,
        period: "monthly",
        nextChargeAt: "2026-07-01",
      },
      {
        id: "pm:scripture",
        payee: "Media Library · scripture-lookup",
        kind: "pay-as-you-go",
        capUsdc: 10,
        spentUsdc: 1.4,
      },
    ],
  },
  entitlements: [
    {
      id: "ent:steward",
      title: "Steward — Cornerstone Fellowship",
      issuer: "Cornerstone Trust Agent",
      scope: "Oversee org agents, treasury, and partner attestations",
      status: "active",
      grantedAt: "2025-09-02",
    },
    {
      id: "ent:library",
      title: "Media Library — full access",
      issuer: "Cornerstone Media Library",
      scope: "Scripture & sermon search, unmetered",
      status: "active",
      grantedAt: "2026-01-14",
      expiresAt: "2026-12-31",
    },
    {
      id: "ent:network",
      title: "City Mission Network — voting member",
      issuer: "City Mission Network",
      scope: "Coalition proposals & shared benevolence pool",
      status: "active",
      grantedAt: "2025-11-20",
    },
  ],
  delegations: [
    {
      id: "del:trustagent",
      direction: "given",
      counterparty: "Cornerstone Trust Agent",
      counterpartyKind: "service",
      canDo: ["Attest partners on my behalf", "Read my steward record"],
      cannotDo: ["Move funds", "Change my profile"],
      grantedAt: "2025-09-02",
      valueCapUsdc: 0,
      revocable: true,
    },
    {
      id: "del:giving",
      direction: "given",
      counterparty: "Cornerstone Giving Agent",
      counterpartyKind: "service",
      canDo: ["Collect monthly tithe up to $50"],
      cannotDo: ["Exceed $50/mo", "Charge ad-hoc"],
      grantedAt: "2025-09-02",
      expiresAt: "2026-09-02",
      valueCapUsdc: 50,
      revocable: true,
    },
    {
      id: "del:network",
      direction: "received",
      counterparty: "City Mission Network",
      counterpartyKind: "org",
      canDo: ["Act for the network in benevolence reviews"],
      cannotDo: ["Bind the network financially"],
      grantedAt: "2025-11-20",
      valueCapUsdc: 0,
      revocable: true,
    },
  ],
  vaultRecords: [
    { type: "person:pii", label: "Personal profile (PII)", class: "sensitive", updatedAt: "2026-05-30", summary: "Legal name, contact, congregation, location" },
    { type: "person:entitlements", label: "Entitlements", class: "public", updatedAt: "2026-01-14", summary: "3 active credentials" },
    { type: "person:delegations", label: "Delegations", class: "restricted", updatedAt: "2025-11-20", summary: "2 given · 1 received" },
    { type: "person:stewardship", label: "Stewardship links", class: "restricted", updatedAt: "2025-09-02", summary: "Custodian of Cornerstone Fellowship" },
    { type: "person:keys", label: "Vault key authorization", class: "restricted", updatedAt: "2025-09-02", summary: "KMS-wrapped DEK · impact-mcp bound" },
  ],
  attestations: [
    { id: "att:p1", by: "Cornerstone Fellowship", statement: "Recognized steward since 2025", at: "2025-09-02", confidence: 1.0 },
    { id: "att:p2", by: "City Mission Network", statement: "Voting member in good standing", at: "2025-11-20", confidence: 1.0 },
  ],
};

// ── Organizations ───────────────────────────────────────────────────────────────
export const ORGS: Organization[] = [
  {
    id: "org:cornerstone",
    kind: "org",
    handle: "cornerstone",
    name: "Cornerstone Fellowship",
    address: addr("0x2B7c1D4e5F6a7B8c9D0e1F2a3B4c5D6e7F8a9B0c"),
    agentName: "cornerstone.impact",
    blurb: "Local congregation · Chicago, IL",
    deployed: true,
    custodians: ["person:grace"],
    memberIds: ["person:grace", "person:samuel", "person:ruth"],
    serviceAgentIds: ["svc:trust", "svc:benevolence", "svc:giving", "svc:media"],
    trust: { overall: 0.9, dimensions: { moral: 0.94, graph: 0.86, historical: 0.92, source: 0.88 }, corroborations: 3 },
    profile: {
      displayName: "Cornerstone Fellowship",
      mission: "A neighborhood church making disciples and serving the city.",
      website: "https://cornerstone.faith",
      contactEmail: "office@cornerstone.faith",
      location: "Chicago, IL",
      sector: "Congregation",
    },
    treasury: {
      ownerId: "org:cornerstone",
      address: addr("0x3C8d2E5f6A7b8C9d0E1f2A3b4C5d6E7f8A9b0C1d"),
      balanceUsdc: 18450.0,
      mandates: [
        { id: "pm:relief", payee: "Global Relief Trust", kind: "subscription", capUsdc: 1000, spentUsdc: 4000, period: "monthly", nextChargeAt: "2026-07-05" },
        { id: "pm:network", payee: "City Mission Network pool", kind: "subscription", capUsdc: 500, spentUsdc: 2500, period: "monthly", nextChargeAt: "2026-07-01" },
      ],
    },
    attestations: [
      { id: "att:o1", by: "City Mission Network", statement: "Founding coalition member", at: "2023-03-01", basis: "cmn:org:0xA1", confidence: 1.0 },
      { id: "att:o2", by: "Seminary of the Word", statement: "Affiliated teaching church", at: "2024-06-12", basis: "sem:rec:118", confidence: 0.96 },
      { id: "att:o3", by: "Global Relief Trust", statement: "Verified giving partner ($48k lifetime)", at: "2026-01-01", confidence: 0.93 },
    ],
  },
  {
    id: "org:citymission",
    kind: "org",
    handle: "citymission",
    name: "City Mission Network",
    address: addr("0x4D9e3F6a7B8c9D0e1F2a3B4c5D6e7F8a9B0c1D2e"),
    agentName: "citymission.impact",
    blurb: "Coalition of 24 churches & ministries",
    deployed: true,
    custodians: ["person:elias"],
    memberIds: ["person:grace", "person:elias"],
    serviceAgentIds: [],
    trust: { overall: 0.87, dimensions: { moral: 0.9, graph: 0.92, historical: 0.84, source: 0.82 }, corroborations: 5 },
    profile: {
      displayName: "City Mission Network",
      mission: "Churches together for the welfare of the city.",
      website: "https://citymission.org",
      contactEmail: "hello@citymission.org",
      location: "Chicago, IL",
      sector: "Coalition",
    },
    treasury: { ownerId: "org:citymission", address: addr("0x5E0f4A7b8C9d0E1f2A3b4C5d6E7f8A9b0C1d2E3f"), balanceUsdc: 92000, mandates: [] },
    attestations: [
      { id: "att:c1", by: "Cornerstone Fellowship", statement: "Trusted coalition convener", at: "2023-03-01", confidence: 1.0 },
    ],
  },
  {
    id: "org:seminary",
    kind: "org",
    handle: "seminary",
    name: "Seminary of the Word",
    address: addr("0x6F1a5B8c9D0e1F2a3B4c5D6e7F8a9B0c1D2e3F4a"),
    agentName: "seminary.impact",
    blurb: "Theological education partner",
    deployed: true,
    custodians: ["person:elias"],
    memberIds: [],
    serviceAgentIds: [],
    trust: { overall: 0.83, dimensions: { scriptural: 0.96, historical: 0.9, source: 0.8 }, corroborations: 2 },
    profile: {
      displayName: "Seminary of the Word",
      mission: "Forming faithful leaders for the church.",
      website: "https://seminaryoftheword.edu",
      location: "Wheaton, IL",
      sector: "Education",
    },
    treasury: { ownerId: "org:seminary", address: addr("0x70b6C9d0E1f2A3b4C5d6E7f8A9b0C1d2E3f4A5b"), balanceUsdc: 0, mandates: [] },
    attestations: [],
  },
  {
    id: "org:globalrelief",
    kind: "org",
    handle: "globalrelief",
    name: "Global Relief Trust",
    address: addr("0x81c7D0e1F2a3B4c5D6e7F8a9B0c1D2e3F4a5B6c"),
    agentName: "globalrelief.impact",
    blurb: "International humanitarian partner",
    deployed: true,
    custodians: [],
    memberIds: [],
    serviceAgentIds: [],
    trust: { overall: 0.79, dimensions: { moral: 0.88, graph: 0.7, historical: 0.82, source: 0.74 }, corroborations: 6 },
    profile: {
      displayName: "Global Relief Trust",
      mission: "Disaster relief and development in 30 countries.",
      website: "https://globalrelief.org",
      location: "Geneva, CH",
      sector: "Humanitarian",
    },
    treasury: { ownerId: "org:globalrelief", address: addr("0x92d8E1f2A3b4C5d6E7f8A9b0C1d2E3f4A5b6C7d"), balanceUsdc: 0, mandates: [] },
    attestations: [],
  },
];

// ── Service smart agents (managed by Cornerstone) ───────────────────────────────
export const SERVICES: ServiceAgent[] = [
  {
    id: "svc:trust",
    kind: "service",
    orgId: "org:cornerstone",
    role: "trust",
    handle: "cornerstone-trust",
    name: "Cornerstone Trust Agent",
    address: addr("0xA3e9F2a3B4c5D6e7F8a9B0c1D2e3F4a5B6c7D8e9"),
    agentName: "trust.cornerstone.impact",
    blurb: "The organization's trust agent — issues & verifies attestations",
    deployed: true,
    trust: { overall: 0.91, dimensions: { graph: 0.95, source: 0.9, historical: 0.88 }, corroborations: 3 },
    skills: [
      { id: "sk:verify-member", name: "Verify membership", description: "Confirm a person is a member in good standing.", a2aId: "trust.verifyMembership", priceUsdc: 0, scope: "read", enabled: true, callsThisMonth: 142 },
      { id: "sk:attest-partner", name: "Attest partner", description: "Issue a signed partner attestation to another org.", a2aId: "trust.attestPartner", priceUsdc: 0, scope: "write·delegated", enabled: true, callsThisMonth: 18 },
      { id: "sk:recommend", name: "Issue recommendation", description: "Produce a verifiable recommendation credential.", a2aId: "trust.recommend", priceUsdc: 0, scope: "write·delegated", enabled: true, callsThisMonth: 7 },
    ],
  },
  {
    id: "svc:benevolence",
    kind: "service",
    orgId: "org:cornerstone",
    role: "benevolence",
    handle: "cornerstone-benevolence",
    name: "Benevolence Desk",
    address: addr("0xB4f0A3b4C5d6E7f8A9b0C1d2E3f4A5b6C7d8E9f0"),
    agentName: "care.cornerstone.impact",
    blurb: "Assesses need and coordinates aid",
    deployed: true,
    trust: { overall: 0.85, dimensions: { moral: 0.93, source: 0.8 }, corroborations: 2 },
    skills: [
      { id: "sk:assess", name: "Assess need", description: "Confidential intake & need assessment.", a2aId: "care.assessNeed", priceUsdc: 0, scope: "read·restricted", enabled: true, callsThisMonth: 31 },
      { id: "sk:disburse", name: "Disburse aid", description: "Release benevolence funds under caveats.", a2aId: "care.disburse", priceUsdc: 0, scope: "treasury·capped", enabled: false, callsThisMonth: 0 },
    ],
  },
  {
    id: "svc:giving",
    kind: "service",
    orgId: "org:cornerstone",
    role: "giving",
    handle: "cornerstone-giving",
    name: "Giving Agent",
    address: addr("0xC5a1B4c5D6e7F8a9B0c1D2e3F4a5B6c7D8e9F0a1"),
    agentName: "giving.cornerstone.impact",
    blurb: "Tithes, offerings, and receipts",
    deployed: true,
    trust: { overall: 0.88, dimensions: { source: 0.9, historical: 0.86 }, corroborations: 2 },
    skills: [
      { id: "sk:tithe", name: "Process tithe", description: "Collect a recurring or one-time gift via x402.", a2aId: "giving.processGift", priceUsdc: 0, scope: "treasury·mandated", enabled: true, callsThisMonth: 64 },
      { id: "sk:receipt", name: "Issue receipt", description: "Verifiable giving receipt credential.", a2aId: "giving.receipt", priceUsdc: 0, scope: "write", enabled: true, callsThisMonth: 64 },
    ],
  },
  {
    id: "svc:media",
    kind: "service",
    orgId: "org:cornerstone",
    role: "media",
    handle: "cornerstone-media",
    name: "Media Library",
    address: addr("0xD6b2C5d6E7f8A9b0C1d2E3f4A5b6C7d8E9f0A1b2"),
    agentName: "media.cornerstone.impact",
    blurb: "Scripture & sermon search (some skills metered)",
    deployed: true,
    trust: { overall: 0.86, dimensions: { scriptural: 0.94, source: 0.88 }, corroborations: 3 },
    skills: [
      { id: "sk:scripture", name: "Scripture lookup", description: "Verifiable scripture passage with provenance.", a2aId: "media.scriptureLookup", priceUsdc: 0.02, scope: "read·metered", enabled: true, callsThisMonth: 530 },
      { id: "sk:sermon", name: "Sermon search", description: "Search the congregation's sermon archive.", a2aId: "media.sermonSearch", priceUsdc: 0, scope: "read", enabled: true, callsThisMonth: 88 },
    ],
  },
];

// ── Peer people referenced in the graph (lightweight refs) ──────────────────────
export const PEERS = [
  { id: "person:elias", kind: "person" as const, handle: "elias", name: "Elias Mwangi", agentName: "elias.impact", address: addr("0xE7c3D6e7F8a9B0c1D2e3F4a5B6c7D8e9F0a1B2c3"), deployed: true, blurb: "Director, City Mission Network" },
  { id: "person:samuel", kind: "person" as const, handle: "samuel", name: "Samuel Adeyemi", agentName: "samuel.impact", address: addr("0xF8d4E7f8A9b0C1d2E3f4A5b6C7d8E9f0A1b2C3d4"), deployed: true, blurb: "Member, Cornerstone" },
  { id: "person:ruth", kind: "person" as const, handle: "ruth", name: "Ruth Bennett", agentName: "ruth.impact", address: addr("0x09e5F8a9B0c1D2e3F4a5B6c7D8e9F0a1B2c3D4e5"), deployed: true, blurb: "Member, Cornerstone" },
];

// ── Trust edges ─────────────────────────────────────────────────────────────────
export const EDGES: TrustEdge[] = [
  // person SA → org SA: stewarding the org is agent-to-agent AUTHORITY (a stewardship
  // delegation), not custody. (Custody = the human → their person SA, injected in the
  // graph builder.)
  { id: "e:grace-cornerstone", from: "person:grace", to: "org:cornerstone", kind: "stewardship", label: "stewards", weight: 1.0 },
  { id: "e:grace-citymission", from: "person:grace", to: "org:citymission", kind: "membership", label: "member", weight: 0.8 },
  { id: "e:elias-citymission", from: "person:elias", to: "org:citymission", kind: "stewardship", label: "stewards", weight: 1.0 },
  { id: "e:elias-seminary", from: "person:elias", to: "org:seminary", kind: "stewardship", label: "stewards", weight: 0.9 },
  { id: "e:samuel-cornerstone", from: "person:samuel", to: "org:cornerstone", kind: "membership", label: "member", weight: 0.7 },
  { id: "e:ruth-cornerstone", from: "person:ruth", to: "org:cornerstone", kind: "membership", label: "member", weight: 0.7 },

  // entitlements are agent-to-agent authority too (a granted credential).
  { id: "e:ent-steward", from: "svc:trust", to: "person:grace", kind: "entitlement", label: "steward entitlement", weight: 0.85 },
  { id: "e:ent-library", from: "svc:media", to: "person:grace", kind: "entitlement", label: "library entitlement", weight: 0.7 },

  // service agents are stewarded by Cornerstone
  { id: "e:cs-trust", from: "org:cornerstone", to: "svc:trust", kind: "stewardship", label: "manages", weight: 1.0 },
  { id: "e:cs-benev", from: "org:cornerstone", to: "svc:benevolence", kind: "stewardship", label: "manages", weight: 1.0 },
  { id: "e:cs-giving", from: "org:cornerstone", to: "svc:giving", kind: "stewardship", label: "manages", weight: 1.0 },
  { id: "e:cs-media", from: "org:cornerstone", to: "svc:media", kind: "stewardship", label: "manages", weight: 1.0 },

  // org-to-org trust assertions (corroborated, carry canon confidence)
  { id: "e:cs-cmn", from: "org:cornerstone", to: "org:citymission", kind: "assertion", label: "trusts · founding member", weight: 0.92, canonConfidence: 1.0, canonMethod: "native-id" },
  { id: "e:cmn-cs", from: "org:citymission", to: "org:cornerstone", kind: "assertion", label: "trusts · convener", weight: 0.9, canonConfidence: 1.0, canonMethod: "native-id" },
  { id: "e:sem-cs", from: "org:seminary", to: "org:cornerstone", kind: "assertion", label: "affiliated", weight: 0.8, canonConfidence: 0.96, canonMethod: "recID match" },
  { id: "e:cs-relief", from: "org:cornerstone", to: "org:globalrelief", kind: "assertion", label: "giving partner", weight: 0.85, canonConfidence: 0.93, canonMethod: "name+domain (review)" },
  { id: "e:cmn-relief", from: "org:citymission", to: "org:globalrelief", kind: "assertion", label: "coalition partner", weight: 0.7, canonConfidence: 0.9, canonMethod: "shared registry" },

  // the trust agent acts on behalf of cornerstone (delegated authority)
  { id: "e:grace-trustagent", from: "person:grace", to: "svc:trust", kind: "delegation", label: "attest on my behalf", weight: 0.9 },

  // payment mandates (treasury → payee)
  { id: "e:cs-relief-pay", from: "org:cornerstone", to: "org:globalrelief", kind: "payment", label: "$1000/mo", weight: 0.6 },
];

export const ACTIVITY: ActivityEvent[] = [
  { id: "ac1", at: "2026-06-22T14:10:00Z", actor: "Cornerstone Trust Agent", verb: "attested", object: "Global Relief Trust as giving partner", context: "org" },
  { id: "ac2", at: "2026-06-20T09:30:00Z", actor: "Giving Agent", verb: "collected", object: "$50 monthly tithe from grace", context: "person" },
  { id: "ac3", at: "2026-06-18T16:45:00Z", actor: "Grace", verb: "granted", object: "Media Library full access entitlement", context: "person" },
  { id: "ac4", at: "2026-06-15T11:02:00Z", actor: "City Mission Network", verb: "invited", object: "Cornerstone to a benevolence review", context: "org" },
  { id: "ac5", at: "2026-06-10T08:00:00Z", actor: "Media Library", verb: "served", object: "530 scripture lookups (metered)", context: "org" },
];

// ── Lookups ───────────────────────────────────────────────────────────────────
export function orgById(id: string): Organization | undefined {
  return ORGS.find((o) => o.id === id);
}
export function serviceById(id: string): ServiceAgent | undefined {
  return SERVICES.find((s) => s.id === id);
}
export function servicesForOrg(orgId: string): ServiceAgent[] {
  return SERVICES.filter((s) => s.orgId === orgId);
}
export function nodeName(id: string): string {
  if (id === PERSON.id) return PERSON.name;
  return (
    orgById(id)?.name ??
    serviceById(id)?.name ??
    PEERS.find((p) => p.id === id)?.name ??
    id
  );
}
