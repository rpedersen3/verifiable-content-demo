// Minimal GCP Cloud-KMS secp256k1 signer — INLINED (not @agenticprimitives/key-custody, whose heavy
// peerDependencies break the validator's standalone `npm install` on Vercel — same trap as the delegation
// dep). Just enough to sign a 32-byte digest with an EC_SIGN_SECP256K1_SHA256 KMS key and return a
// recoverable 65-byte signature, so the validator signs its ValidationAttestation AS demo-validator.impact
// via a key that NEVER leaves the HSM (no held private key). Node runtime (Vercel functions) — uses
// node:crypto for the SA JWT and viem for ECDSA recovery.
import { createSign } from 'node:crypto';
import { recoverAddress, type Address, type Hex } from 'viem';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const KMS_BASE = 'https://cloudkms.googleapis.com/v1';
const SCOPE = 'https://www.googleapis.com/auth/cloudkms';
const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const HALF_N = SECP256K1_N >> 1n;

interface ServiceAccount { client_email: string; private_key: string }

/** Parse JSON that may have LITERAL newlines/tabs inside string values (a common env-var paste mistake for a
 *  service-account `private_key`). Escapes control chars ONLY inside strings (preserving inter-field
 *  whitespace), so both a clean single-line value and a multi-line paste parse. */
export function parseLooseJson<T>(raw: string): T {
  try { return JSON.parse(raw) as T; } catch { /* fall through to repair */ }
  let out = '', inStr = false, esc = false;
  for (const ch of raw) {
    if (esc) { out += ch; esc = false; continue; }
    if (ch === '\\') { out += ch; esc = true; continue; }
    if (ch === '"') { inStr = !inStr; out += ch; continue; }
    if (inStr && ch === '\n') { out += '\\n'; continue; }
    if (inStr && ch === '\r') { out += '\\r'; continue; }
    if (inStr && ch === '\t') { out += '\\t'; continue; }
    out += ch;
  }
  return JSON.parse(out) as T;
}

function b64url(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64decode(s: string): Uint8Array { return new Uint8Array(Buffer.from(s, 'base64')); }
function bytesToBigInt(b: Uint8Array): bigint { let n = 0n; for (const x of b) n = (n << 8n) | BigInt(x); return n; }
function to32(n: bigint): Uint8Array { const o = new Uint8Array(32); let v = n; for (let i = 31; i >= 0; i--) { o[i] = Number(v & 0xffn); v >>= 8n; } return o; }
function hex(b: Uint8Array): string { return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join(''); }

/** Parse a DER ECDSA signature → { r, s }. */
function parseDer(der: Uint8Array): { r: bigint; s: bigint } {
  let i = 0;
  const at = (j: number): number => { const b = der[j]; if (b === undefined) throw new Error('DER: unexpected end'); return b; };
  if (at(i++) !== 0x30) throw new Error('DER: expected SEQUENCE');
  const lenByte = at(i++);
  if (lenByte & 0x80) i += lenByte & 0x7f; // skip long-form length bytes
  if (at(i++) !== 0x02) throw new Error('DER: expected INTEGER r');
  const rLen = at(i++); const r = bytesToBigInt(der.slice(i, i + rLen)); i += rLen;
  if (at(i++) !== 0x02) throw new Error('DER: expected INTEGER s');
  const sLen = at(i++); const s = bytesToBigInt(der.slice(i, i + sLen));
  return { r, s };
}

export interface KmsSigner {
  /** signDigest(32-byte hash) → recoverable 65-byte secp256k1 signature (recovers to `address`). */
  signDigest(hash: Hex): Promise<Hex>;
  /** The KMS key's Ethereum address (the delegate key authorized by the issuer SA). */
  readonly address: Address;
}

/**
 * Build a KMS signer. `expectedAddress` is the KMS key's known Ethereum address (the authorized delegate
 * key, e.g. demo-validator.impact's 0x00314c…) — used to disambiguate the ECDSA recovery byte without
 * fetching/parsing the public key. Cloud KMS doesn't return the recovery bit, so we try v∈{27,28} and keep
 * the one that recovers to this address.
 */
export function makeKmsSigner(opts: { keyName: string; serviceAccountJson: string; expectedAddress: Address }): KmsSigner {
  const sa = parseLooseJson<ServiceAccount>(opts.serviceAccountJson);
  let token: { value: string; exp: number } | null = null;

  async function accessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (token && token.exp > now + 60) return token.value;
    const header = b64url(Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
    const payload = b64url(Buffer.from(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 })));
    const input = `${header}.${payload}`;
    const sig = createSign('RSA-SHA256').update(input).sign(sa.private_key);
    const assertion = `${input}.${b64url(sig)}`;
    const res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${encodeURIComponent(assertion)}` });
    if (!res.ok) throw new Error(`KMS token exchange failed: ${res.status}`);
    const j = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!j.access_token) throw new Error('KMS token: no access_token');
    token = { value: j.access_token, exp: now + (j.expires_in ?? 3600) };
    return token.value;
  }

  return {
    address: opts.expectedAddress,
    async signDigest(hash: Hex): Promise<Hex> {
      const tok = await accessToken();
      const digestB64 = Buffer.from((hash.startsWith('0x') ? hash.slice(2) : hash), 'hex').toString('base64');
      const res = await fetch(`${KMS_BASE}/${opts.keyName}:asymmetricSign`, {
        method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
        body: JSON.stringify({ digest: { sha256: digestB64 } }),
      });
      if (!res.ok) throw new Error(`KMS asymmetricSign failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
      const { signature } = (await res.json()) as { signature: string };
      let { r, s } = parseDer(b64decode(signature));
      if (s > HALF_N) s = SECP256K1_N - s; // EIP-2 low-s
      const rs = `0x${hex(to32(r))}${hex(to32(s))}` as Hex;
      for (const v of [27, 28] as const) {
        const sig = `${rs}${v.toString(16)}` as Hex;
        try {
          const rec = await recoverAddress({ hash, signature: sig });
          if (rec.toLowerCase() === opts.expectedAddress.toLowerCase()) return sig;
        } catch { /* try the other recovery bit */ }
      }
      throw new Error('KMS sign: neither recovery byte matched the expected key address');
    },
  };
}
