#!/usr/bin/env node
// Provision fresh per-issuer Cloud-KMS signing keys for delegated content trust (spec 266).
//
// Each content issuer (bsb.impact, lbsb.impact) gets its OWN secp256k1 signing key inside
// Google Cloud KMS. The key NEVER leaves KMS — the MCP's GcpKmsSigner asks KMS to sign a
// digest and gets back a signature. The issuer SA later authorizes that key via an
// owner-signed ERC-7710 delegation (the demo-corpus "Authorize content signing" ceremony),
// so the key signs descriptors ON BEHALF OF the issuer without ever holding the issuer's key.
//
// secp256k1 in GCP KMS REQUIRES protectionLevel=HSM (Software is not offered for this curve).
//
// Auth: GCP_SERVICE_ACCOUNT_JSON (the SAME service account already used by the A2A relayer's
// GcpKmsSigner) → RS256 JWT → OAuth token. No private signing key is ever handled here.
//
// Usage (with the SA key file at ~/content-signer-admin-sa.json, zero flags needed):
//   node scripts/provision-content-signer-keys.mjs [name ...]
// Or point at the key explicitly:
//   GCP_SERVICE_ACCOUNT_FILE=/path/to/sa.json node scripts/provision-content-signer-keys.mjs
//
// Defaults: location=us-central1, keyring=content-signers, names="bsb.impact lbsb.impact demo-validator.impact".
// The set is every KMS-delegated SIGNING IDENTITY on the platform — content issuers + the validator (and
// later the resolver agent). Prints the CONTENT_SIGNER_KEYS JSON map to paste into `wrangler secret put`
// for the MCP (and the validator/a2a, which fetch their own delegation + sign their VCs via these keys).

import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const KMS_BASE = 'https://cloudkms.googleapis.com/v1';
const SCOPE = 'https://www.googleapis.com/auth/cloudkms';

const LOCATION = process.env.KMS_LOCATION ?? 'us-central1';
const KEYRING = process.env.KMS_KEYRING ?? 'content-signers';
const ISSUERS = process.argv.slice(2).length ? process.argv.slice(2) : ['bsb.impact', 'lbsb.impact', 'demo-validator.impact'];

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function loadServiceAccount() {
  // SA can come from (in order): GCP_SERVICE_ACCOUNT_JSON (inline), GCP_SERVICE_ACCOUNT_FILE (a path),
  // or a key file at ~/content-signer-admin-sa.json. So you can just drop the key in your home dir and run.
  let raw = process.env.GCP_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    const file = process.env.GCP_SERVICE_ACCOUNT_FILE ?? join(homedir(), 'content-signer-admin-sa.json');
    try {
      raw = readFileSync(file, 'utf8');
      console.error(`(loaded service account from ${file})`);
    } catch {
      console.error(`FATAL: provide the service account via GCP_SERVICE_ACCOUNT_JSON, GCP_SERVICE_ACCOUNT_FILE=<path>, or a key file at ${file}`);
      process.exit(1);
    }
  }
  let sa;
  try { sa = JSON.parse(raw); } catch { console.error('FATAL: GCP_SERVICE_ACCOUNT_JSON is not valid JSON.'); process.exit(1); }
  if (!sa.client_email || !sa.private_key) { console.error('FATAL: SA JSON missing client_email/private_key.'); process.exit(1); }
  if (!sa.project_id) { console.error('FATAL: SA JSON missing project_id (needed to address the keyring).'); process.exit(1); }
  return sa;
}

async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }));
  const signingInput = `${header}.${payload}`;
  const sig = createSign('RSA-SHA256').update(signingInput).sign(sa.private_key);
  const assertion = `${signingInput}.${b64url(sig)}`;
  const body = `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${encodeURIComponent(assertion)}`;
  const res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  if (!res.ok) throw new Error(`token exchange failed: HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  if (!json.access_token) throw new Error('token exchange: no access_token');
  return json.access_token;
}

async function kms(token, path, { method = 'GET', body, query } = {}) {
  const qs = query ? `?${new URLSearchParams(query)}` : '';
  const init = { method, headers: { authorization: `Bearer ${token}` } };
  if (body) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
  const res = await fetch(`${KMS_BASE}/${path}${qs}`, init);
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  return { ok: res.ok, status: res.status, json };
}

// GCP key IDs allow [a-zA-Z0-9_-] only — map an issuer name like "lbsb.impact" → "lbsb-impact".
const keyId = (issuer) => issuer.replace(/[^a-zA-Z0-9_-]/g, '-');

async function ensureKeyring(token, project) {
  const parent = `projects/${project}/locations/${LOCATION}`;
  const get = await kms(token, `${parent}/keyRings/${KEYRING}`);
  if (get.ok) { console.log(`  keyring exists: ${KEYRING}`); return; }
  if (get.status !== 404) throw new Error(`keyring GET failed: HTTP ${get.status}: ${JSON.stringify(get.json).slice(0, 300)}`);
  const created = await kms(token, `${parent}/keyRings`, { method: 'POST', query: { keyRingId: KEYRING }, body: {} });
  if (!created.ok) throw new Error(`keyring create failed: HTTP ${created.status}: ${JSON.stringify(created.json).slice(0, 300)}`);
  console.log(`  keyring created: ${KEYRING}`);
}

async function ensureSigningKey(token, project, issuer) {
  const parent = `projects/${project}/locations/${LOCATION}/keyRings/${KEYRING}`;
  const id = keyId(issuer);
  const keyPath = `${parent}/cryptoKeys/${id}`;
  let key = await kms(token, keyPath);
  if (!key.ok) {
    if (key.status !== 404) throw new Error(`cryptoKey GET failed for ${issuer}: HTTP ${key.status}: ${JSON.stringify(key.json).slice(0, 300)}`);
    const created = await kms(token, `${parent}/cryptoKeys`, {
      method: 'POST',
      query: { cryptoKeyId: id },
      body: {
        purpose: 'ASYMMETRIC_SIGN',
        versionTemplate: { algorithm: 'EC_SIGN_SECP256K1_SHA256', protectionLevel: 'HSM' },
        labels: { app: 'verifiable-content-demo', role: 'content-signer' },
      },
    });
    if (!created.ok) throw new Error(`cryptoKey create failed for ${issuer}: HTTP ${created.status}: ${JSON.stringify(created.json).slice(0, 300)}`);
    console.log(`  created signing key for ${issuer} → cryptoKeys/${id}`);
    key = { ok: true, json: created.json };
  } else {
    console.log(`  signing key exists for ${issuer} → cryptoKeys/${id}`);
  }

  // Find/await an ENABLED version. Creating a key auto-creates version 1 (HSM generation is async).
  const versionName = `${keyPath}/cryptoKeyVersions/1`;
  for (let attempt = 0; attempt < 30; attempt++) {
    const v = await kms(token, versionName);
    if (v.ok && v.json.state === 'ENABLED') return versionName;
    if (v.ok && v.json.state === 'DESTROYED') throw new Error(`${issuer} version 1 is DESTROYED`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`${issuer} version 1 did not reach ENABLED within timeout`);
}

// Grant the RUNTIME service account data-plane access (sign + viewPublicKey) on the keyring.
// roles/cloudkms.admin (used to CREATE keys) does NOT include sign/viewPublicKey — those live in
// roles/cloudkms.signerVerifier — so without this the MCP's runtime SA 403s on every signing/verify.
// Bound at the keyRing level so it covers every issuer key under it. Idempotent (skips if already a member).
const SIGNER_ROLE = 'roles/cloudkms.signerVerifier';
async function ensureSignerBinding(token, project, runtimeSaEmail) {
  const keyRingPath = `projects/${project}/locations/${LOCATION}/keyRings/${KEYRING}`;
  const member = `serviceAccount:${runtimeSaEmail}`;
  const got = await kms(token, `${keyRingPath}:getIamPolicy`);
  if (!got.ok) throw new Error(`getIamPolicy failed: HTTP ${got.status}: ${JSON.stringify(got.json).slice(0, 300)}`);
  const policy = got.json && typeof got.json === 'object' ? got.json : {};
  policy.bindings = policy.bindings || [];
  let binding = policy.bindings.find((b) => b.role === SIGNER_ROLE);
  if (binding && (binding.members || []).includes(member)) {
    console.log(`  IAM: ${runtimeSaEmail} already has ${SIGNER_ROLE} on ${KEYRING}`);
    return;
  }
  if (!binding) { binding = { role: SIGNER_ROLE, members: [] }; policy.bindings.push(binding); }
  binding.members = binding.members || [];
  binding.members.push(member);
  const set = await kms(token, `${keyRingPath}:setIamPolicy`, { method: 'POST', body: { policy } });
  if (!set.ok) throw new Error(`setIamPolicy failed: HTTP ${set.status}: ${JSON.stringify(set.json).slice(0, 300)}`);
  console.log(`  IAM: granted ${SIGNER_ROLE} to ${runtimeSaEmail} on ${KEYRING}`);
}

async function main() {
  const sa = loadServiceAccount();
  const project = sa.project_id;
  console.log(`Provisioning content-signer keys in project=${project} location=${LOCATION} keyring=${KEYRING}`);
  console.log(`Issuers: ${ISSUERS.join(', ')}\n`);
  const token = await getAccessToken(sa);
  await ensureKeyring(token, project);

  const map = {};
  for (const issuer of ISSUERS) {
    map[issuer] = await ensureSigningKey(token, project, issuer);
  }

  // The runtime SA that the MCP authenticates as. Defaults to THIS SA (the common case: the same
  // GCP_SERVICE_ACCOUNT_JSON is used to provision + set as the MCP secret). Override RUNTIME_SA_EMAIL
  // if the MCP runs under a different SA than the one provisioning.
  const runtimeSa = process.env.RUNTIME_SA_EMAIL ?? sa.client_email;
  await ensureSignerBinding(token, project, runtimeSa);

  const json = JSON.stringify(map);
  console.log('\n✅ CONTENT_SIGNER_KEYS (issuerName → KMS cryptoKeyVersion):\n');
  console.log(JSON.stringify(map, null, 2));
  console.log('\nSet it on the MCP worker (the SAME GCP_SERVICE_ACCOUNT_JSON the relayer already uses):');
  console.log('  cd apps/demo-bible-mcp');
  console.log(`  echo '${json}' | npx wrangler secret put CONTENT_SIGNER_KEYS --env production`);
  console.log('  npx wrangler secret put GCP_SERVICE_ACCOUNT_JSON --env production   # paste the SA JSON');
  console.log('\nThen set TRUST_MODE=delegated (wrangler.toml [env.production.vars]) and redeploy.');
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
