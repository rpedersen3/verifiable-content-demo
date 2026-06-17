// spec 277 §10 — entitlement gating for the vault. Owner-issued AgenticEntitlementCredentialV1s authorize an
// actor to read an owner's resource/fields; resolveEntitlements is fail-closed (allow only if a credential
// matches actor+audience+resource+action+fields+purpose and the data classification is ≤ the credential's
// ceiling). VC proof/status verification is a later upstream wave — credentials here are stored + trusted.
import { resolveEntitlements, type AgenticEntitlementCredentialV1, type EntitlementAction, type EntitlementClassification, type EntitlementDecision } from '@agenticprimitives/entitlements';
import type { VaultClassification } from '@agenticprimitives/vault';
import type { D1Like } from '../editions/d1.js';

// Vault has more classes than the entitlement ceiling ladder; map the vault-only "*.private" classes to a
// conservative (high) entitlement class so they're never under-protected.
const CLASS_MAP: Record<VaultClassification, EntitlementClassification> = {
  public: 'public',
  internal: 'internal',
  'pii.low': 'pii.low',
  'pii.sensitive': 'pii.sensitive',
  'secret.high': 'secret.high',
  'regulated.high': 'regulated.high',
  'delegation.private': 'secret.high',
  'entitlement.private': 'pii.sensitive',
  'agent.memory.private': 'pii.sensitive',
};
export const toEntitlementClass = (c: VaultClassification): EntitlementClassification => CLASS_MAP[c];

export async function loadEntitlements(db: D1Like, principal: string, actor: string): Promise<AgenticEntitlementCredentialV1[]> {
  const rows = (await db.prepare('SELECT credential FROM vault_entitlements WHERE principal=? AND actor=?').bind(principal, actor).all<{ credential: string }>()).results;
  return rows.map((r) => JSON.parse(r.credential) as AgenticEntitlementCredentialV1);
}

export interface GrantInput {
  principal: string;
  actor: string;
  audience: string;
  resource: string;
  actions?: EntitlementAction[];
  fields?: string[];
  purpose?: string;
  classificationCeiling?: EntitlementClassification;
  validUntil?: string;
}

/** Build an owner-issued entitlement credential (self-asserted by the owner; signing is a later wave). */
export function buildEntitlementCredential(g: GrantInput): AgenticEntitlementCredentialV1 {
  return {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    type: ['VerifiableCredential', 'AgenticEntitlementCredentialV1'],
    id: `urn:ap:entitlement:${crypto.randomUUID()}`,
    issuer: g.principal,
    validFrom: new Date().toISOString(),
    ...(g.validUntil ? { validUntil: g.validUntil } : {}),
    credentialSubject: {
      id: g.actor,
      principal: g.principal,
      audience: g.audience,
      resource: g.resource,
      actions: g.actions ?? ['read'],
      ...(g.fields ? { fields: g.fields } : {}),
      ...(g.purpose ? { purpose: g.purpose } : {}),
      ...(g.classificationCeiling ? { classificationCeiling: g.classificationCeiling } : {}),
    },
  };
}

export async function storeEntitlement(db: D1Like, cred: AgenticEntitlementCredentialV1): Promise<void> {
  const s = cred.credentialSubject;
  await db.prepare('INSERT INTO vault_entitlements(id,principal,actor,resource,credential,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET credential=excluded.credential')
    .bind(cred.id, s.principal ?? '', s.id, s.resource, JSON.stringify(cred), new Date().toISOString()).run();
}

/** Fail-closed read gate: resolve the actor's entitlements for this owner against the read query. */
export async function gateVaultRead(
  db: D1Like,
  args: { principal: string; actor: string; audience: string; resource: string; fields?: string[]; purpose?: string; classification: EntitlementClassification },
): Promise<EntitlementDecision> {
  const creds = await loadEntitlements(db, args.principal, args.actor);
  return resolveEntitlements(creds, {
    actor: args.actor,
    principal: args.principal,
    audience: args.audience,
    resource: args.resource,
    action: 'read',
    fields: args.fields,
    purpose: args.purpose,
    classification: args.classification,
    at: new Date(),
  });
}
