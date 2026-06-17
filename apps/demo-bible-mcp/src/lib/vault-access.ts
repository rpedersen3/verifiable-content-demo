// spec 277 §10 — entitlement gating for the vault. Owner-issued AgenticEntitlementCredentialV1s authorize an
// actor to read an owner's resource/fields; resolveEntitlements is fail-closed (allow only if a credential
// matches actor+audience+resource+action+fields+purpose and the data classification is ≤ the credential's
// ceiling). VC proof/status verification is a later upstream wave — credentials here are stored + trusted.
import { resolveEntitlements, type AgenticEntitlementCredentialV1, type EntitlementAction, type EntitlementClassification, type EntitlementDecision } from '@agenticprimitives/entitlements';
import { createDecryptGrant, verifyDecryptGrant, createInMemoryReplayStore, canonicalize, sha256Hex, type KeyReleaseDecision } from '@agenticprimitives/key-authorization';
import { projectFields, type VaultClassification } from '@agenticprimitives/vault';
import { createD1Vault } from './vault.js';
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

// ── spec 277 §14 — one-time DecryptGrant + KAS re-verification (P3) ──
// After the durable entitlement check (gateVaultRead) allows, the authority mints a one-time DecryptGrant
// bound to THIS request (tool + argsHash + resource + fields + purpose + classification + the entitlement
// decision hash), and the KAS independently re-verifies it before any field is released. JTI is one-time
// (replay store). In P5 the same allow gates the key-custody DEK unwrap; here it gates plaintext projection.
const replayStore = createInMemoryReplayStore(); // per-isolate (Phase-1 demo; a durable D1/DO store in prod)

export async function keyReleaseForRead(args: {
  serverId: string;
  resourceUri: string;
  audience: string;
  principal: string;
  actor: string;
  resource: string;
  allowedFields?: string[];
  purpose?: string;
  classification: EntitlementClassification;
  matchedCredentials: string[];
}): Promise<KeyReleaseDecision> {
  const argsHash = await sha256Hex(canonicalize({ principal: args.principal, actor: args.actor, resource: args.resource, fields: args.allowedFields ?? null, purpose: args.purpose ?? null }));
  const entHash = await sha256Hex(canonicalize(args.matchedCredentials)); // bind the grant to the entitlement decision
  const now = new Date();
  const ttlSeconds = 120;
  const grant = await createDecryptGrant({
    id: `urn:ap:decrypt-grant:${crypto.randomUUID()}`,
    issuer: args.serverId,
    audience: args.audience,
    principal: args.principal,
    delegate: args.actor,
    mcp: { resourceUri: args.resourceUri, serverId: args.serverId, toolName: 'vault_get', argsHash },
    authorization: { entitlementHashes: [entHash] },
    vault: { vaultId: args.serverId, objectIds: [`${args.principal}/${args.resource}`], resource: args.resource, fields: args.allowedFields, purpose: args.purpose, classificationCeiling: args.classification },
    constraints: { ttlSeconds, notBefore: now.toISOString(), expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(), oneTimeUse: true },
    replay: { jti: crypto.randomUUID() },
  });
  return verifyDecryptGrant(
    grant,
    { audience: args.audience, principal: args.principal, delegate: args.actor, toolName: 'vault_get', argsHash, resource: args.resource, requestedFields: args.allowedFields, purpose: args.purpose, classification: args.classification, entitlementHashes: [entHash] },
    { now, replayStore },
  );
}

// ── Shared two-gate vault read (entitlement → one-time DecryptGrant/KAS), used by both the service-hmac
//    tool (vault_get) and the OAuth-protected HTTP lane (/mcp/vault/read). ──
export type GatedReadResult =
  | { kind: 'not_found' }
  | { kind: 'denied'; stage: 'entitlement' | 'key-release'; reason: string }
  | { kind: 'ok'; object: { owner: string; resource: string; classification: VaultClassification; data: unknown; updatedAt: string }; released: string[] | null; constraints: unknown };

export async function gatedVaultRead(
  db: D1Like,
  args: { owner: string; actor: string; resource: string; fields?: string[]; purpose?: string; audience: string; serverId: string; resourceUri: string },
): Promise<GatedReadResult> {
  const obj = await createD1Vault(db).read({ owner: args.owner, resource: args.resource });
  if (!obj) return { kind: 'not_found' };
  const cls = toEntitlementClass(obj.classification);
  const decision = await gateVaultRead(db, { principal: args.owner, actor: args.actor, audience: args.audience, resource: args.resource, fields: args.fields, purpose: args.purpose, classification: cls });
  if (decision.decision !== 'allow') return { kind: 'denied', stage: 'entitlement', reason: decision.reason };
  const release = await keyReleaseForRead({ serverId: args.serverId, resourceUri: args.resourceUri, audience: args.audience, principal: args.owner, actor: args.actor, resource: args.resource, allowedFields: decision.allowedFields, purpose: args.purpose, classification: cls, matchedCredentials: decision.matchedCredentials });
  if (release.decision !== 'allow') return { kind: 'denied', stage: 'key-release', reason: release.reason };
  return { kind: 'ok', object: { ...obj, data: projectFields(obj.data, release.releasedFields) }, released: release.releasedFields ?? null, constraints: decision.constraints ?? null };
}
