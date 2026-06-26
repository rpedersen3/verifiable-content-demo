// Client read-side for the person's related-agent links + delegations (spec 246/247/275).
// Relationships now live in the PERSON'S VAULT (vault:impact-relationships, durable D1), read over
// the delegation-presented access layer — NOT the (ephemeral) broker KV, and never inferred from
// custody. The Vault Delegations tab renders the FLATTENED view these produce.
import type { Address } from "./types";
import type { DelegationWire } from "./delegation";
import type { AccessContext } from "./access";
import { loadRelationships, cachedRelationships, type AgentRelationship } from "./relationships-store";

export type AgentKind = "person-treasury" | "org" | "org-treasury" | "server" | "person";

/** One of the connected person's home-managed agents (private vault link). */
export interface MyOrg {
  orgAgent: Address;
  orgName: string;
  purpose: string;
  requestedBy: string;
  createdAt: number | null;
  proofHash?: string | null;
  kind?: AgentKind;
  /** A scoped grant the person issued to a relying site (delegator = a person agent). */
  delegation?: DelegationWire | null;
  /** membership = person→agent (the agent reads its member). */
  membershipDelegation?: DelegationWire | null;
  /** stewardship = agent→person (the person reads/oversees the agent). */
  stewardshipDelegation?: DelegationWire | null;
}

/** An inbound grant one of the person's agents RECEIVED (org↔org only — ADR-0025). */
export interface ReceivedDelegation {
  viaOrg: Address;
  viaOrgName: string;
  orgAgent: Address;
  orgName: string;
  delegation?: DelegationWire | null;
}

/** Map a vault AgentRelationship onto the MyOrg shape the UI consumes. */
function toMyOrg(r: AgentRelationship): MyOrg {
  return {
    orgAgent: r.agent,
    orgName: r.agentName ?? "",
    purpose: r.purpose ?? "",
    requestedBy: "",
    createdAt: r.createdAt ?? null,
    kind: r.kind,
    delegation: r.grants?.site ?? null,
    membershipDelegation: r.grants?.membership ?? null,
    stewardshipDelegation: r.grants?.stewardship ?? null,
  };
}

/** Instant, NON-blocking view of the person's relationships from the local cache (no vault read).
 *  Used for first paint; `listMyOrgs` refreshes from the vault. */
export function cachedMyOrgs(personSA: string): MyOrg[] {
  return cachedRelationships(personSA).map(toMyOrg);
}

/** List ALL the connected person's related agents, read from their VAULT over a presented self
 *  delegation. Returns [] (and falls back to the cache via the caller) on any failure (fail-closed). */
export async function listMyOrgs(ctx: AccessContext): Promise<MyOrg[]> {
  try {
    const rels = await loadRelationships(ctx);
    return rels.map(toMyOrg);
  } catch {
    return [];
  }
}

/** Inbound org↔org delegations are not modelled in the person's relationship vault — return none
 *  for now (the cross-principal entitlement path covers member access). */
export async function listMyReceivedDelegations(_ctx: AccessContext): Promise<ReceivedDelegation[]> {
  return [];
}

// ── Flattened view model for the Vault Delegations tab ────────────────────────────────────────

export type DelegationRole = "stewardship" | "membership" | "site" | "received";

export interface LiveDelegation {
  id: string;
  /** The other agent in the relationship (name when known, else short address). */
  counterparty: string;
  counterpartyAddr: Address;
  role: DelegationRole;
  /** Human label for what the grant authorizes. */
  scope: string;
  /** "you → them" (you control the delegator) vs "them → you" (inbound). */
  direction: "given" | "received";
  grantedAt: number | null;
  /** The on-chain wire struct — present iff this grant is revocable by the person. */
  wire?: DelegationWire;
  revocable: boolean;
}

const short = (a: string): string => `${a.slice(0, 6)}…${a.slice(-4)}`;
const label = (name: string | undefined, addr: Address): string => (name && name.trim() ? name : short(addr));

/** Flatten the person's related agents + inbound grants into the unified delegation list the
 *  Vault renders. A grant is `revocable` when the person controls its DELEGATOR (their own agent),
 *  which is exactly the case for the stewardship / membership / site grants in their own tree;
 *  received org↔org grants are delegated by an external grantor, so the person cannot revoke them. */
export function flattenDelegations(orgs: MyOrg[], received: ReceivedDelegation[]): LiveDelegation[] {
  const out: LiveDelegation[] = [];
  for (const o of orgs) {
    const cp = label(o.orgName, o.orgAgent);
    const kindWord = o.kind === "person-treasury" ? "treasury" : o.kind === "org-treasury" ? "org treasury" : "agent";
    if (o.stewardshipDelegation) {
      out.push({
        id: `stewardship:${o.orgAgent}`,
        counterparty: cp, counterpartyAddr: o.orgAgent, role: "stewardship",
        scope: `Read & oversee this ${kindWord}'s vault`,
        direction: "given", grantedAt: o.createdAt, wire: o.stewardshipDelegation, revocable: true,
      });
    }
    if (o.membershipDelegation) {
      out.push({
        id: `membership:${o.orgAgent}`,
        counterparty: cp, counterpartyAddr: o.orgAgent, role: "membership",
        scope: `Lets this ${kindWord} read your membership`,
        direction: "given", grantedAt: o.createdAt, wire: o.membershipDelegation, revocable: true,
      });
    }
    if (o.delegation) {
      out.push({
        id: `site:${o.orgAgent}`,
        counterparty: cp, counterpartyAddr: o.orgAgent, role: "site",
        scope: "Scoped access (naming + relationship)",
        direction: "given", grantedAt: o.createdAt, wire: o.delegation, revocable: true,
      });
    }
  }
  for (const r of received) {
    out.push({
      id: `received:${r.viaOrg}:${r.orgAgent}`,
      counterparty: label(r.orgName, r.orgAgent), counterpartyAddr: r.orgAgent, role: "received",
      scope: `Inbound access to ${label(r.viaOrgName, r.viaOrg)}`,
      direction: "received", grantedAt: null, wire: r.delegation ?? undefined, revocable: false,
    });
  }
  return out;
}
