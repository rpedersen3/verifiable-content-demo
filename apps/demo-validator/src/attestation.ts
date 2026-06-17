// ValidationAttestation — the validator's SIGNED result over an evidence bundle
// (a VC, same Eip712Signature2026 pattern as citations/entitlements).
//
// Identity modes:
//   VALIDATOR_SA set  → the validator IS a Smart Agent. The OWNER signs EIP-191
//                       and the SA's ERC-1271 isValidSignature validates.
//   else (EOA)        → the EOA signs raw and verifiers recover the address.

import { signCredential, VC_CONTEXT_V2, EIP712_SIG_2026_CONTEXT, type UnsignedCredential } from '@agenticprimitives/verifiable-credentials';
import { keccak256, toBytes, type Address, type Hex } from 'viem';
// spec 276 §7 — the inline kms-signer.ts is gone; sign via the consumer-safe @agenticprimitives/key-custody/kms-core
// surface (peer-free: only @noble/* transitively, no viem/audit forced). createGcpKmsTransport handles the SA
// JWT → token → publicKey/asymmetricSign; signDigestWithKms derives the recovery byte from the SPKI public key.
import { signDigestWithKms, addressFromSpkiPem, parseServiceAccountJson, createGcpKmsTransport } from '@agenticprimitives/key-custody/kms-core';

/** Parse JSON that may contain LITERAL control chars (newline/CR/tab) inside string values — a recurring
 *  env-var paste artifact for VALIDATOR_DELEGATION_LEAF (see the validator-kms memory). Escapes control
 *  chars ONLY inside string literals so a multi-line paste still parses. The SA JSON goes through
 *  parseServiceAccountJson (which also accepts base64), but the delegation leaf has no base64 form, so it
 *  needs this repair — strict JSON.parse here was a spec-276 regression that disabled KMS signing. */
function parseLooseJson<T>(raw: string): T {
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

const SA = process.env.VALIDATOR_SA as Address | undefined;
export const VALIDATOR_CHAIN_ID = Number(process.env.VALIDATOR_CHAIN_ID ?? 84532);
export const VALIDATOR_NAME = process.env.VALIDATOR_NAME ?? 'demo-validator.agent';

// spec 266 — KMS-DELEGATED signing, NO held key: the validator's SA (demo-validator.impact) authorized a
// Cloud-KMS key via a stored ERC-7710 delegation. The KMS key signs the attestation; the proof carries the
// leaf so verifiers root trust in the SA via ERC-1271 while the day-to-day signer is the (rotatable) HSM key.
// .trim() the key path: a stray leading/trailing space (paste artifact) goes straight into the KMS REST
// URL and yields a generic 404. JSON.parse tolerates surrounding whitespace, but a raw URL segment does not.
const KMS_KEY = process.env.VALIDATOR_KMS_KEY?.trim();
const KMS_LEAF_JSON = process.env.VALIDATOR_DELEGATION_LEAF;
const GCP_SA = process.env.GCP_SERVICE_ACCOUNT_JSON;
let kmsMode = !!(SA && KMS_KEY && KMS_LEAF_JSON && GCP_SA);
let kmsReason: string | null = kmsMode ? null
  : `missing env: ${[!SA && 'VALIDATOR_SA', !KMS_KEY && 'VALIDATOR_KMS_KEY', !KMS_LEAF_JSON && 'VALIDATOR_DELEGATION_LEAF', !GCP_SA && 'GCP_SERVICE_ACCOUNT_JSON'].filter(Boolean).join(', ')}`;

let delegatingSigner: { delegatorIssuer: Address; delegateKey: Address; delegationLeaf: unknown } | undefined;
let kmsSignDigest: ((hash: Hex) => Promise<Hex>) | undefined;
if (kmsMode) {
  // FAIL-SAFE: a malformed VALIDATOR_DELEGATION_LEAF / GCP_SERVICE_ACCOUNT_JSON must NOT crash the whole
  // validator at module load — disable KMS (signing then fails closed, no held-key fallback) and surface why
  // in /health. GCP_SERVICE_ACCOUNT_JSON must be stored as single-line JSON or base64 (parseServiceAccountJson
  // accepts both); a raw multi-line paste with literal newlines in `private_key` is rejected → KMS off.
  try {
    const leaf = parseLooseJson<{ delegate?: string }>(KMS_LEAF_JSON!);
    if (!leaf?.delegate) throw new Error('VALIDATOR_DELEGATION_LEAF has no `delegate`');
    const delegate = leaf.delegate as Address;
    const transport = createGcpKmsTransport(parseServiceAccountJson(GCP_SA!));
    // Fetch + cache the KMS key's SPKI public key ONCE, then sign each digest via kms-core (it derives the
    // recovery byte from the public key). On first use, assert the key's derived address IS the delegated key
    // (§7 step-5 verification at runtime) — on drift we throw, so signing fails closed rather than producing a
    // signature that won't ERC-1271-validate under the issuer SA.
    let pem: string | undefined;
    const ensureKey = async (): Promise<string> => {
      if (pem) return pem;
      const fetched = await transport.getPublicKeyPem(KMS_KEY!);
      const derived = addressFromSpkiPem(fetched);
      if (derived.toLowerCase() !== delegate.toLowerCase()) {
        throw new Error(`KMS key address ${derived} ≠ delegated key ${delegate} (wrong VALIDATOR_KMS_KEY or stale VALIDATOR_DELEGATION_LEAF)`);
      }
      pem = fetched;
      return fetched;
    };
    kmsSignDigest = async (hash: Hex): Promise<Hex> =>
      signDigestWithKms({ digest: toBytes(hash), publicKeyPem: await ensureKey(), asymmetricSign: (d: Uint8Array) => transport.asymmetricSign(KMS_KEY!, d) });
    delegatingSigner = { delegatorIssuer: SA!, delegateKey: delegate, delegationLeaf: leaf };
  } catch (e) {
    kmsMode = false;
    kmsReason = (e as Error).message;
    // eslint-disable-next-line no-console
    console.error('[validator] KMS signing DISABLED (invalid config — fails closed, no held-key fallback):', kmsReason);
  }
}
/** Whether the validator is signing attestations via the delegated HSM-KMS key (vs the dev held key). */
export const KMS_SIGNING = kmsMode;
/** Diagnostics for /health — which KMS env vars are present + why KMS is off (no secret values). */
export const KMS_DEBUG = { guard: 'nofallback-v5', sa: !!SA, kmsKey: !!KMS_KEY, leaf: !!KMS_LEAF_JSON, gcpSa: !!GCP_SA, reason: kmsReason };

// NO held-key fallback. The validator signs ONLY via the KMS-delegated key (demo-validator.impact).
// Identity is the SA (VALIDATOR_SA); the day-to-day signer is the rotatable HSM delegate. If KMS isn't
// configured, signing FAILS CLOSED (reason surfaced in /health.kms) — it never silently signs with a dev key.
export const IS_SA = !!SA;
export const VALIDATOR_ADDRESS = SA as Address; // required; kmsMode already gates on SA being set
export const VALIDATOR_AGENT_ID = `eip155:${VALIDATOR_CHAIN_ID}:${VALIDATOR_ADDRESS}`;

const noSigner = (): Promise<Hex> =>
  Promise.reject(new Error(`validator signing not configured — KMS required, no held-key fallback (${kmsReason ?? 'KMS disabled'})`));

// Digest signer: the KMS delegate key (raw secp256k1, recovers to the delegate). No fallback.
const signDigest: (hash: Hex) => Promise<Hex> = kmsMode ? kmsSignDigest! : noSigner;

const credentialSigner = {
  issuerAddress: VALIDATOR_ADDRESS,
  chainId: VALIDATOR_CHAIN_ID,
  verifyingContract: VALIDATOR_ADDRESS,
  signDigest,
};

/** Sign the on-chain attestation-anchor digest via the SAME KMS delegate key (no held key). Anchoring is
 *  env-gated and currently disabled; when enabled, registry verification must take the delegatingSigner /
 *  ERC-1271 path since the signer is the delegate, not a direct SA custodian. */
export function signAnchorDigest(digest: Hex): Promise<Hex> {
  return signDigest(digest);
}

export function hashJson(x: unknown): Hex {
  return keccak256(toBytes(JSON.stringify(x)));
}

export interface AttestationInput {
  subjectAgentId: string;
  subjectName?: string;
  agentRunId: string;
  outputId: string;
  evidenceBundleHash: Hex;
  responseHash: string;
  validationProfile: string;
  outcome: string;
  checksHash: Hex;
  issuedAt: string; // caller passes (Date is available in Node, not in scripts)
}

interface AttestationSubject extends Record<string, unknown> {
  validatorAgentId: string;
  validatorName: string;
}

/** Build + sign a ValidationAttestation VC over the bundle the validator checked. */
export async function buildValidationAttestation(input: AttestationInput) {
  const unsigned: UnsignedCredential<AttestationSubject> = {
    '@context': [VC_CONTEXT_V2, EIP712_SIG_2026_CONTEXT],
    type: ['VerifiableCredential', 'ValidationAttestation'],
    issuer: `agent:${VALIDATOR_NAME}`,
    validFrom: input.issuedAt,
    credentialSubject: {
      validatorAgentId: VALIDATOR_AGENT_ID,
      validatorName: VALIDATOR_NAME,
      subjectAgentId: input.subjectAgentId,
      subjectName: input.subjectName,
      agentRunId: input.agentRunId,
      outputId: input.outputId,
      evidenceBundleHash: input.evidenceBundleHash,
      responseHash: input.responseHash,
      validationProfile: input.validationProfile,
      outcome: input.outcome,
      checksHash: input.checksHash,
    },
  };
  // In delegated mode the proof carries the issuer→KMS-key leaf (delegate signs, SA is the root of trust).
  return signCredential(unsigned, credentialSigner, kmsMode ? { delegatingSigner } : undefined);
}
