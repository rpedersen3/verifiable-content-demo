// The person's AGENT RELATIONSHIPS — to organizations, treasuries, servers, or other persons — held
// in the person's OWN encrypted vault (vault:impact-relationships, durable D1 in impact-mcp), NOT the
// broker KV and NOT inferred from custody. Each entry is a DOLCE+DnS dns:Assertion the person makes
// about a relationship (a gc:Attestation ⊂ gc:Assessment ⊂ dns:Assertion, per CLAUDE.md): ACCESS to
// the agent is established by the GRANTS (delegations) + entitlements carried here — never by custody.
// Read/written over the person's session delegation (the delegation-presented access layer).

import { readVaultRecord, writeVaultRecord, type AccessContext } from "./access";
import type { DelegationWire } from "./delegation";
import type { Address } from "@agenticprimitives/types";

export type AgentKind = "org" | "person-treasury" | "org-treasury" | "server" | "person";
export type RelationRole = "steward" | "member" | "site" | "peer";

/** One relationship the person asserts to another agent. */
export interface AgentRelationship {
  agent: Address;                 // the related agent (the assertion's object)
  agentName: string | null;
  kind: AgentKind;
  relation: RelationRole;
  purpose: string;
  parent: Address;                // where it hangs in the person's agent tree
  createdAt: number;
  /** The grants that ESTABLISH access (ERC-7710 delegations) — not custody. */
  grants: {
    stewardship?: DelegationWire | null;  // agent→person (the person reads/oversees the agent)
    membership?: DelegationWire | null;   // person→agent
    site?: DelegationWire | null;
  };
  /** Entitlement-credential ids that gate access in this relationship. */
  entitlements?: string[];
  /** The assertion's trust signal (CLAUDE.md canon_*): confidence + method + basis. */
  attestation: { type: "gc:Attestation"; confidence: number; method: string; basis: string };
}

export interface StoredRelationships { v: 1; relationships: AgentRelationship[]; }

const RELATIONSHIPS_RECORD = "impact-relationships";
const CACHE_PREFIX = "impact.relationships.v1:";

// ── localStorage cache (instant render + resilience; the vault D1 is the source of truth) ──────────
function cacheKey(personSA: string): string { return CACHE_PREFIX + personSA.toLowerCase(); }

export function cachedRelationships(personSA: string): AgentRelationship[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(cacheKey(personSA));
    const list = raw ? (JSON.parse(raw) as AgentRelationship[]) : [];
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

function writeCache(personSA: string, list: AgentRelationship[]): void {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(cacheKey(personSA), JSON.stringify(list)); } catch { /* ignore */ }
}

/** The vault OWNER whose relationships record this ctx reads — the person (self) or the org. Both
 *  cache under their own address, so an org's relationships (e.g. its org-treasury) cache too. */
function ownerOf(ctx: AccessContext): string {
  return ctx.kind === "self" ? ctx.personSA : ctx.orgSA;
}

/** Read the person's relationships from their vault (caches the result). */
export async function loadRelationships(ctx: AccessContext): Promise<AgentRelationship[]> {
  const rec = await readVaultRecord<StoredRelationships>(ctx, RELATIONSHIPS_RECORD);
  const list = rec && rec.v === 1 && Array.isArray(rec.relationships) ? rec.relationships : [];
  const o = ownerOf(ctx);
  writeCache(o, list);
  return list;
}

export async function saveRelationships(ctx: AccessContext, relationships: AgentRelationship[]): Promise<void> {
  await writeVaultRecord(ctx, RELATIONSHIPS_RECORD, { v: 1, relationships } satisfies StoredRelationships);
  const o = ownerOf(ctx);
  writeCache(o, relationships);
}

/** Add or MERGE a relationship by agent address (a re-save never clobbers grants it doesn't carry). */
export async function upsertRelationship(ctx: AccessContext, rel: AgentRelationship): Promise<void> {
  const list = await loadRelationships(ctx);
  const i = list.findIndex((r) => r.agent.toLowerCase() === rel.agent.toLowerCase());
  if (i >= 0) {
    const prev = list[i]!;
    list[i] = {
      ...prev, ...rel,
      grants: { ...prev.grants, ...rel.grants },
      entitlements: rel.entitlements ?? prev.entitlements,
      createdAt: prev.createdAt ?? rel.createdAt,
    };
  } else {
    list.push(rel);
  }
  await saveRelationships(ctx, list);
}

export async function removeRelationship(ctx: AccessContext, agent: Address): Promise<void> {
  const list = await loadRelationships(ctx);
  await saveRelationships(ctx, list.filter((r) => r.agent.toLowerCase() !== agent.toLowerCase()));
}
