// The member's ENTITLEMENTS — verifiable credentials an issuer (an org / service) grants them.
// Per the entitlement-storage decision, the CANONICAL store is the reader's OWN per-person
// encrypted vault at impact-mcp (`vault:impact-entitlements`, sealed under the member's GCP-KMS
// KEK), written there at grant time and read back by the reader. The home holds no key material:
// it reads/writes over the same-origin `/mcp-bind` proxy by minting an OAuth token for the
// logged-in member and calling the owner-reads/writes-own `get_impact_entitlements` /
// `set_impact_entitlements` tools. No binding (vault key not activated) ⇒ fail-closed.
// Mirrors src/lib/profile-store.ts.

import type { Address } from "@agenticprimitives/types";
import { VaultKeyUnauthorizedError } from "./profile-store";

/** One held credential. `selfAsserted` records provenance honestly: when the issuer IS the
 *  holder (a credential the person recorded about themselves), there is NO third-party
 *  verification — the UI must show that rather than dress it up as externally attested. */
export interface ImpactEntitlement {
  id: string;
  title: string;
  issuer: string;
  issuerAddr?: string;
  scope: string;
  status: "active" | "expired" | "pending";
  grantedAt: string;
  expiresAt?: string;
  selfAsserted?: boolean;
}

export interface ImpactStoredEntitlements {
  v: 1;
  entitlements: ImpactEntitlement[];
}

const MCP_BIND = "/mcp-bind";

async function mintToken(principal: Address): Promise<string> {
  const res = await fetch(`${MCP_BIND}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ principal }),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (body.error === "vault_key_unauthorized") throw new VaultKeyUnauthorizedError();
  if (!res.ok || !body.access_token) throw new Error(`mint failed: ${body.error ?? res.status}`);
  return body.access_token;
}

async function callMcp(token: string, tool: string, args?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`${MCP_BIND}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ tool, args: args ?? {} }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (body.error === "vault_key_unauthorized") throw new VaultKeyUnauthorizedError();
  return body;
}

/** Read the member's encrypted entitlements. Empty if never written. Throws
 *  `VaultKeyUnauthorizedError` if they haven't activated their vault key yet. */
export async function loadImpactEntitlements(addr: Address): Promise<ImpactEntitlement[]> {
  const token = await mintToken(addr);
  const out = await callMcp(token, "get_impact_entitlements");
  const record = out.record as ImpactStoredEntitlements | null | undefined;
  if (record && record.v === 1 && Array.isArray(record.entitlements)) return record.entitlements;
  return [];
}

/** Seal the member's entitlements into their vault under their own KEK. Throws
 *  `VaultKeyUnauthorizedError` if they haven't activated their vault key yet. */
export async function saveImpactEntitlements(addr: Address, entitlements: ImpactEntitlement[]): Promise<void> {
  const token = await mintToken(addr);
  const out = await callMcp(token, "set_impact_entitlements", { data: { v: 1, entitlements } satisfies ImpactStoredEntitlements });
  if (out.ok !== true) throw new Error(`save failed: ${String(out.error ?? "unknown")}`);
}
