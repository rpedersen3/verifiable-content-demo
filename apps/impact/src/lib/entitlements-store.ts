// The member's ENTITLEMENTS — verifiable credentials an issuer (an org / service) grants them.
// Per the entitlement-storage decision, the CANONICAL store is the reader's OWN per-person
// encrypted vault at impact-mcp (`vault:impact-entitlements`, sealed under the member's GCP-KMS
// KEK), written there at grant time and read back by the reader. Access is delegation-presented
// (custody ≠ access): a signed delegation authorizes the read over impact-a2a /mcp/vault/{get,set};
// no binding (vault key not activated) ⇒ fail-closed. Mirrors src/lib/profile-store.ts.

import { readVaultRecord, writeVaultRecord, VaultKeyUnauthorizedError, type AccessContext } from "./access";

export { VaultKeyUnauthorizedError };

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

/** spec 278 vault resource (`vault:impact-entitlements`) — same record as the get_impact_entitlements
 *  tool, read/written over the generic delegation-presented vault path. */
const ENTITLEMENTS_RECORD = "impact-entitlements";

/** Read the subject's encrypted entitlements over a presented delegation. Empty if never written.
 *  Throws `VaultKeyUnauthorizedError` if the subject's vault isn't activated. */
export async function loadImpactEntitlements(ctx: AccessContext): Promise<ImpactEntitlement[]> {
  const record = await readVaultRecord<ImpactStoredEntitlements>(ctx, ENTITLEMENTS_RECORD);
  return record && record.v === 1 && Array.isArray(record.entitlements) ? record.entitlements : [];
}

/** Seal the subject's entitlements into its vault over a presented delegation. Throws
 *  `VaultKeyUnauthorizedError` if the subject's vault isn't activated. */
export async function saveImpactEntitlements(ctx: AccessContext, entitlements: ImpactEntitlement[]): Promise<void> {
  await writeVaultRecord(ctx, ENTITLEMENTS_RECORD, { v: 1, entitlements } satisfies ImpactStoredEntitlements);
}
