// spec 277 §6–§8 — OAuth 2.1 ingress for the MCP vault (via @agenticprimitives/mcp-oauth). OAuth is the
// INGRESS adapter only, NOT the vault authority: a validated bearer references an McpGrantBundleV1 by
// id+hash; the bundle carries the principal/delegate + entitlement/delegation/policy hashes, and the normal
// delegated vault path (entitlements + decrypt-grant) runs off it. The inbound token is never reused downstream.
//
// The demo issuer here mints HMAC-signed bearer tokens (a minimal JWT-like) so the flow is exercisable
// without a full authorization server; in production `verify` is JWKS signature verification.
import { validateMcpBearerToken, resolveGrantBundleFromToken, createMcpGrantBundle, bindOAuthTokenToGrantBundle, sha256Hex, type McpAccessTokenClaims, type McpGrantBundleV1, type GrantBundleStore, type BearerValidation } from '@agenticprimitives/mcp-oauth';
import type { D1Like } from '../editions/d1.js';

const enc = new TextEncoder();
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlToStr = (s: string) => atob(s.replace(/-/g, '+').replace(/_/g, '/'));

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data))));
}

/** Sign demo bearer claims (payload.sig, HMAC-SHA256). Production = a real OAuth AS + JWKS. */
export async function signDemoToken(claims: McpAccessTokenClaims, secret: string): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify(claims)));
  return `${payload}.${await hmac(secret, payload)}`;
}

/** The injected `verify` for validateMcpBearerToken — checks the HMAC + decodes claims (null on mismatch). */
export function demoTokenVerifier(secret: string) {
  return async (token: string): Promise<McpAccessTokenClaims | null> => {
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return null;
    if ((await hmac(secret, payload)) !== sig) return null;
    try { return JSON.parse(b64urlToStr(payload)) as McpAccessTokenClaims; } catch { return null; }
  };
}

/** D1-backed GrantBundleStore (resolveGrantBundleFromToken re-checks the hash for anti-swap). */
export function grantBundleStore(db: D1Like): GrantBundleStore & { put(b: McpGrantBundleV1): Promise<void> } {
  return {
    async get(id: string) {
      const row = await db.prepare('SELECT bundle FROM grant_bundles WHERE id=?').bind(id).first<{ bundle: string }>();
      return row ? (JSON.parse(row.bundle) as McpGrantBundleV1) : null;
    },
    async put(b: McpGrantBundleV1) {
      await db.prepare('INSERT INTO grant_bundles(id,bundle,created_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET bundle=excluded.bundle').bind(b.id, JSON.stringify(b), new Date().toISOString()).run();
    },
  };
}

export interface MintInput {
  issuer: string; clientId: string; audience: string; resourceUri: string; serverId: string;
  principal: string; delegate: string; resource: string; fields?: string[]; purpose?: string;
  classificationCeiling?: string; scopes: string[]; ttlSeconds?: number;
}

/** Demo authorization-server step: build + store an McpGrantBundleV1 and mint a bearer bound to it. */
export async function mintVaultToken(db: D1Like, secret: string, m: MintInput): Promise<{ token: string; bundleId: string }> {
  const now = new Date();
  const ttl = m.ttlSeconds ?? 300;
  const expiresAt = new Date(now.getTime() + ttl * 1000).toISOString();
  const bundle = await createMcpGrantBundle({
    id: `urn:ap:mcp-grant:${crypto.randomUUID()}`,
    oauth: { issuer: m.issuer, clientId: m.clientId, subject: m.delegate, audience: m.audience, scopes: m.scopes },
    principal: { id: m.principal },
    delegate: { id: m.delegate },
    mcp: { resourceUri: m.resourceUri, serverId: m.serverId, allowedTools: ['vault_get'] },
    delegation: { delegationHash: await sha256Hex(`demo-delegation:${m.principal}:${m.delegate}`), caveatsHash: await sha256Hex('demo-caveats'), expiresAt, revocation: { mode: 'none' } },
    entitlements: [{ entitlementHash: await sha256Hex(`ent:${m.principal}:${m.delegate}:${m.resource}`), issuer: m.principal, subject: m.delegate, resource: m.resource, actions: ['read'], ...(m.fields ? { fields: m.fields } : {}), ...(m.purpose ? { purpose: m.purpose } : {}), ...(m.classificationCeiling ? { classificationCeiling: m.classificationCeiling } : {}) }],
    constraints: { maxTtlSeconds: ttl },
    replay: { jtiSeed: crypto.randomUUID(), nonceScope: 'oauth-token' },
    policy: { profile: 'mcp-delegated-vault-v1', policyHash: await sha256Hex('demo-policy'), toolPolicyVersion: '1' },
    issuedAt: now.toISOString(),
    expiresAt,
    status: 'active',
  });
  await grantBundleStore(db).put(bundle);
  const claims: McpAccessTokenClaims = {
    iss: m.issuer, sub: m.delegate, aud: m.audience, client_id: m.clientId,
    jti: crypto.randomUUID(), iat: Math.floor(now.getTime() / 1000), exp: Math.floor(now.getTime() / 1000) + ttl,
    scope: m.scopes.join(' '), resource: m.resourceUri,
    ...bindOAuthTokenToGrantBundle(bundle),
  };
  return { token: await signDemoToken(claims, secret), bundleId: bundle.id };
}

export interface IngressResult {
  ok: boolean;
  status?: number;
  reason?: string;
  bundle?: McpGrantBundleV1;
  validation?: BearerValidation;
}

/** Validate the bearer (fail-closed) + resolve its grant bundle (anti-swap hash check). */
export async function ingressFromBearer(db: D1Like, token: string | null, secret: string, opts: { audience: string; requiredScopes: string[] }): Promise<IngressResult> {
  const v = await validateMcpBearerToken(token, { verify: demoTokenVerifier(secret), audience: opts.audience, requiredScopes: opts.requiredScopes, requireGrantBinding: true });
  if (!v.ok) return { ok: false, status: v.reason === 'insufficient_scope' ? 403 : 401, reason: v.reason, validation: v };
  const r = await resolveGrantBundleFromToken(v.claims, grantBundleStore(db));
  if (!r.ok) return { ok: false, status: 401, reason: r.reason };
  return { ok: true, bundle: r.bundle };
}
