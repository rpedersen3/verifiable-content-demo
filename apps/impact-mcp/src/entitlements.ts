// impact-mcp's entitlement gate (spec 277 Phase 3).
//
// Sensitive / cross-principal reads resolve an entitlement BEFORE the vault decrypts any field, and
// the decision's `allowedFields` scopes the projection. Policy (testnet grade):
//
//   - Owner-reads-own (actor == principal) → full access to all requested fields. Covers the flows
//     where withDelegation recovers the DELEGATOR (the data owner) reading its OWN namespace.
//   - Cross-principal access (a MEMBER reading an ORG's data) → gated SOLELY by a matching, granted,
//     unexpired AgenticEntitlementCredentialV1 in `entitlements_issued` (the issuer ledger / authority
//     store). NO custody or stewardship is consulted: the entitlement IS the access. The
//     @agenticprimitives matching engine checks no signature (credentials are trusted upstream — the
//     issue path authenticated the org as its own custodian), so a granted row IS a valid grant.
//
// Issuance + revocation live in the issue_org_entitlement / revoke_org_entitlement tools (index.ts).

import {
  type EntitlementResolver,
  type EntitlementQuery,
  type EntitlementDecision,
  type AgenticEntitlementCredentialV1,
  type EntitlementAction,
  type EntitlementClassification,
  InMemoryEntitlementResolver,
} from '@agenticprimitives/entitlements';

/** Load the granted, unexpired entitlement credentials an OWNER (principal) issued to a GRANTEE
 *  (actor). The resolver matches these against the read query; an empty set ⇒ fail-closed deny. */
async function loadIssuedCredentials(db: D1Database, principal: string, actor: string): Promise<AgenticEntitlementCredentialV1[]> {
  const nowIso = new Date().toISOString();
  const res = await db
    .prepare(
      `SELECT credential FROM entitlements_issued
        WHERE principal = ? AND actor = ? AND status = 'granted'
          AND (valid_until IS NULL OR valid_until > ?)`,
    )
    .bind(principal.toLowerCase(), actor.toLowerCase(), nowIso)
    .all<{ credential: string }>();
  const out: AgenticEntitlementCredentialV1[] = [];
  for (const row of res.results ?? []) {
    try { out.push(JSON.parse(row.credential) as AgenticEntitlementCredentialV1); } catch { /* skip a corrupt row */ }
  }
  return out;
}

/** The entitlement resolver: owner-self → full; otherwise consult the org's issued grants in D1. */
export function entitlementResolver(env: { DB: D1Database }): EntitlementResolver {
  return {
    async resolve(q: EntitlementQuery): Promise<EntitlementDecision> {
      if (q.principal && q.actor.toLowerCase() === q.principal.toLowerCase()) {
        return { decision: 'allow', reason: 'matched', matchedCredentials: ['owner-self'], allowedFields: q.fields };
      }
      if (!q.principal) {
        return { decision: 'deny', reason: 'principal_mismatch', matchedCredentials: [] };
      }
      const creds = await loadIssuedCredentials(env.DB, q.principal, q.actor);
      return new InMemoryEntitlementResolver(creds).resolve(q);
    },
  };
}

export interface BuildEntitlementInput {
  issuer: string;            // the issuing ORG (also the data principal)
  subject: string;          // the GRANTEE member SA (credentialSubject.id / query.actor)
  audience: string;         // MCP audience
  resource: string;         // vault resource, e.g. vault:impact-profile
  actions: EntitlementAction[];
  fields?: string[];        // undefined ⇒ all fields
  classificationCeiling?: EntitlementClassification;
  purpose?: string;
  validFromIso: string;
  validUntilIso?: string;
  id: string;               // urn:ap:entitlement:<uuid>
}

/** Build an unsigned AgenticEntitlementCredentialV1. The `entitlements_issued` ledger is the trusted
 *  authority (the matching engine ignores `proof`), so no on-chain signature is required for the gate;
 *  issuance is authenticated by the org presenting its own authority (token principal == the org). */
export function buildOrgEntitlement(input: BuildEntitlementInput): AgenticEntitlementCredentialV1 {
  return {
    '@context': ['https://www.w3.org/ns/credentials/v2', 'https://agenticprimitives.dev/credentials/v1'],
    type: ['VerifiableCredential', 'AgenticEntitlementCredentialV1'],
    id: input.id as `urn:ap:entitlement:${string}`,
    issuer: input.issuer,
    validFrom: input.validFromIso,
    ...(input.validUntilIso ? { validUntil: input.validUntilIso } : {}),
    credentialSubject: {
      id: input.subject,
      principal: input.issuer,
      audience: input.audience,
      resource: input.resource,
      actions: input.actions,
      ...(input.fields ? { fields: input.fields } : {}),
      ...(input.classificationCeiling ? { classificationCeiling: input.classificationCeiling } : {}),
      ...(input.purpose ? { purpose: input.purpose } : {}),
    },
  };
}
