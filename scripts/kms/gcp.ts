// GCP Cloud KMS provisioning — gcloud-free (REST + SA-JWT), idempotent. Ports the proven approach from
// scripts/provision-content-signer-keys.mjs into reusable, manifest-driven TS, and derives each key's EVM
// address via the peer-free @agenticprimitives/key-custody/kms-core surface. IAM is granted PER-KEY
// (roles/cloudkms.signerVerifier = sign + viewPublicKey) for master-key separation.
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { addressFromSpkiPem, createGcpKmsTransport, parseServiceAccountJson } from '@agenticprimitives/key-custody/kms-core';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const KMS_BASE = 'https://cloudkms.googleapis.com/v1';
const SCOPE = 'https://www.googleapis.com/auth/cloudkms';
const SIGNER_ROLE = 'roles/cloudkms.signerVerifier';

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export interface LoadedSA {
  /** The raw single-line JSON (for parseServiceAccountJson / writing as a base64 secret). */
  raw: string;
  client_email: string;
  private_key: string;
  project_id: string;
}

export function loadServiceAccount(file: string): LoadedSA {
  const raw = readFileSync(file, 'utf8').trim();
  const sa = parseServiceAccountJson(raw) as { client_email: string; private_key: string; project_id?: string };
  if (!sa.project_id) throw new Error(`service account ${file} missing project_id`);
  return { raw, client_email: sa.client_email, private_key: sa.private_key, project_id: sa.project_id };
}

async function accessToken(sa: LoadedSA): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }));
  const sig = createSign('RSA-SHA256').update(`${header}.${payload}`).sign(sa.private_key);
  const assertion = `${header}.${payload}.${b64url(sig)}`;
  const res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${encodeURIComponent(assertion)}` });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { access_token?: string };
  if (!j.access_token) throw new Error('token exchange: no access_token');
  return j.access_token;
}

async function kms(token: string, path: string, opts: { method?: string; body?: unknown; query?: Record<string, string> } = {}) {
  const qs = opts.query ? `?${new URLSearchParams(opts.query)}` : '';
  const init: RequestInit = { method: opts.method ?? 'GET', headers: { authorization: `Bearer ${token}` } };
  if (opts.body) { (init.headers as Record<string, string>)['content-type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
  const res = await fetch(`${KMS_BASE}/${path}${qs}`, init);
  const text = await res.text();
  return { ok: res.ok, status: res.status, json: text ? JSON.parse(text) : {} };
}

export class GcpProvisioner {
  private token!: string;
  constructor(private sa: LoadedSA, private location: string, private keyRing: string) {}
  async init() { this.token = await accessToken(this.sa); }
  private get project() { return this.sa.project_id; }
  private get ringPath() { return `projects/${this.project}/locations/${this.location}/keyRings/${this.keyRing}`; }

  async ensureKeyRing(): Promise<boolean> {
    const get = await kms(this.token, this.ringPath);
    if (get.ok) return false;
    if (get.status !== 404) throw new Error(`keyRing GET failed: ${get.status} ${JSON.stringify(get.json).slice(0, 200)}`);
    const created = await kms(this.token, `projects/${this.project}/locations/${this.location}/keyRings`, { method: 'POST', query: { keyRingId: this.keyRing }, body: {} });
    if (!created.ok) throw new Error(`keyRing create failed: ${created.status} ${JSON.stringify(created.json).slice(0, 200)}`);
    return true;
  }

  /** Ensure an HSM secp256k1 signing key + an ENABLED version. Returns { keyVersionName, created }. */
  async ensureSigningKey(keyId: string): Promise<{ keyVersionName: string; created: boolean }> {
    const keyPath = `${this.ringPath}/cryptoKeys/${keyId}`;
    let created = false;
    const get = await kms(this.token, keyPath);
    if (!get.ok) {
      if (get.status !== 404) throw new Error(`cryptoKey GET failed for ${keyId}: ${get.status}`);
      const c = await kms(this.token, `${this.ringPath}/cryptoKeys`, { method: 'POST', query: { cryptoKeyId: keyId }, body: { purpose: 'ASYMMETRIC_SIGN', versionTemplate: { algorithm: 'EC_SIGN_SECP256K1_SHA256', protectionLevel: 'HSM' }, labels: { managed_by: 'ap-kms' } } });
      if (!c.ok) throw new Error(`cryptoKey create failed for ${keyId}: ${c.status} ${JSON.stringify(c.json).slice(0, 200)}`);
      created = true;
    }
    const keyVersionName = `${keyPath}/cryptoKeyVersions/1`;
    for (let i = 0; i < 30; i++) {
      const v = await kms(this.token, keyVersionName);
      if (v.ok && v.json.state === 'ENABLED') return { keyVersionName, created };
      if (v.ok && v.json.state === 'DESTROYED') throw new Error(`${keyId} version 1 is DESTROYED`);
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error(`${keyId} version 1 did not reach ENABLED in time`);
  }

  /** Read-only: the ENABLED key-version resource name if the key exists, else null (no creation). For --verify. */
  async keyVersionIfExists(keyId: string): Promise<string | null> {
    const keyVersionName = `${this.ringPath}/cryptoKeys/${keyId}/cryptoKeyVersions/1`;
    const v = await kms(this.token, keyVersionName);
    if (v.ok && v.json.state === 'ENABLED') return keyVersionName;
    return null;
  }

  /** Grant the runtime SA roles/cloudkms.signerVerifier on THIS key only (per-key separation). Idempotent. */
  async ensureKeyIam(keyId: string, memberEmail: string): Promise<boolean> {
    const keyPath = `${this.ringPath}/cryptoKeys/${keyId}`;
    const member = `serviceAccount:${memberEmail}`;
    const got = await kms(this.token, `${keyPath}:getIamPolicy`);
    if (!got.ok) throw new Error(`getIamPolicy failed for ${keyId}: ${got.status}`);
    const policy = (got.json && typeof got.json === 'object' ? got.json : {}) as { bindings?: Array<{ role: string; members?: string[] }> };
    policy.bindings = policy.bindings ?? [];
    let binding = policy.bindings.find((b) => b.role === SIGNER_ROLE);
    if (binding && (binding.members ?? []).includes(member)) return false;
    if (!binding) { binding = { role: SIGNER_ROLE, members: [] }; policy.bindings.push(binding); }
    binding.members = [...(binding.members ?? []), member];
    const set = await kms(this.token, `${keyPath}:setIamPolicy`, { method: 'POST', body: { policy } });
    if (!set.ok) throw new Error(`setIamPolicy failed for ${keyId}: ${set.status} ${JSON.stringify(set.json).slice(0, 200)}`);
    return true;
  }
}

/** Derive a KMS key's EVM signing address from its SPKI public key (the address an issuer SA authorizes). */
export async function deriveKeyAddress(saRaw: string, keyVersionName: string): Promise<`0x${string}`> {
  const transport = createGcpKmsTransport(parseServiceAccountJson(saRaw));
  return addressFromSpkiPem(await transport.getPublicKeyPem(keyVersionName));
}
