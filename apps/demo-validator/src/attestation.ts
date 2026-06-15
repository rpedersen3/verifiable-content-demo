// ValidationAttestation — the validator's SIGNED result over an evidence bundle
// (a VC, same Eip712Signature2026 pattern as citations/entitlements).
//
// Identity modes:
//   VALIDATOR_SA set  → the validator IS a Smart Agent. The OWNER signs EIP-191
//                       and the SA's ERC-1271 isValidSignature validates.
//   else (EOA)        → the EOA signs raw and verifiers recover the address.

import { signCredential, VC_CONTEXT_V2, EIP712_SIG_2026_CONTEXT, type UnsignedCredential } from '@agenticprimitives/verifiable-credentials';
import { keccak256, toBytes, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { makeKmsSigner } from './kms-signer.js';

const SA = process.env.VALIDATOR_SA as Address | undefined;
export const VALIDATOR_CHAIN_ID = Number(process.env.VALIDATOR_CHAIN_ID ?? 84532);
export const VALIDATOR_NAME = process.env.VALIDATOR_NAME ?? 'demo-validator.agent';

// spec 266 — KMS-DELEGATED signing, NO held key: the validator's SA (demo-validator.impact) authorized a
// Cloud-KMS key via a stored ERC-7710 delegation. The KMS key signs the attestation; the proof carries the
// leaf so verifiers root trust in the SA via ERC-1271 while the day-to-day signer is the (rotatable) HSM key.
const KMS_KEY = process.env.VALIDATOR_KMS_KEY;
const KMS_LEAF_JSON = process.env.VALIDATOR_DELEGATION_LEAF;
const GCP_SA = process.env.GCP_SERVICE_ACCOUNT_JSON;
let kmsMode = !!(SA && KMS_KEY && KMS_LEAF_JSON && GCP_SA);
let kmsReason: string | null = kmsMode ? null
  : `missing env: ${[!SA && 'VALIDATOR_SA', !KMS_KEY && 'VALIDATOR_KMS_KEY', !KMS_LEAF_JSON && 'VALIDATOR_DELEGATION_LEAF', !GCP_SA && 'GCP_SERVICE_ACCOUNT_JSON'].filter(Boolean).join(', ')}`;

let delegatingSigner: { delegatorIssuer: Address; delegateKey: Address; delegationLeaf: unknown } | undefined;
let kmsSignDigest: ((hash: Hex) => Promise<Hex>) | undefined;
if (kmsMode) {
  // FAIL-SAFE: a malformed VALIDATOR_DELEGATION_LEAF / GCP_SERVICE_ACCOUNT_JSON must NOT crash the whole
  // validator at module load — disable KMS and fall back to the dev signer, logging why (surfaced in health).
  try {
    const leaf = JSON.parse(KMS_LEAF_JSON!) as { delegate: string };
    if (!leaf?.delegate) throw new Error('VALIDATOR_DELEGATION_LEAF has no `delegate`');
    const kms = makeKmsSigner({ keyName: KMS_KEY!, serviceAccountJson: GCP_SA!, expectedAddress: leaf.delegate as Address });
    kmsSignDigest = (hash: Hex) => kms.signDigest(hash);
    delegatingSigner = { delegatorIssuer: SA!, delegateKey: leaf.delegate as Address, delegationLeaf: leaf };
  } catch (e) {
    kmsMode = false;
    kmsReason = (e as Error).message;
    // eslint-disable-next-line no-console
    console.error('[validator] KMS signing DISABLED (invalid config — falling back to dev signer):', kmsReason);
  }
}
/** Whether the validator is signing attestations via the delegated HSM-KMS key (vs the dev held key). */
export const KMS_SIGNING = kmsMode;
/** Diagnostics for /health — which KMS env vars are present + why KMS is off (no secret values). */
export const KMS_DEBUG = { sa: !!SA, kmsKey: !!KMS_KEY, leaf: !!KMS_LEAF_JSON, gcpSa: !!GCP_SA, reason: kmsReason };

// DEV-ONLY held-key fallback (when KMS isn't configured). NOT used in delegated mode.
const OWNER_PK = (process.env.VALIDATOR_OWNER_PK ?? process.env.VALIDATOR_SIGNER_PK ?? '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6') as Hex;
const owner = privateKeyToAccount(OWNER_PK);

export const IS_SA = !!SA;
export const VALIDATOR_ADDRESS = (SA ?? owner.address) as Address;
export const VALIDATOR_AGENT_ID = `eip155:${VALIDATOR_CHAIN_ID}:${VALIDATOR_ADDRESS}`;

// Digest signer: KMS delegate key (raw secp256k1, recovers to the delegate) in delegated mode; else the
// dev held key — SA→EIP-191 (ERC-1271 validates) or EOA→raw.
const signDigest: (hash: Hex) => Promise<Hex> = kmsMode
  ? kmsSignDigest!
  : SA ? (hash: Hex) => owner.signMessage({ message: { raw: hash } }) : (hash: Hex) => owner.sign({ hash });

const credentialSigner = {
  issuerAddress: VALIDATOR_ADDRESS,
  chainId: VALIDATOR_CHAIN_ID,
  verifyingContract: VALIDATOR_ADDRESS,
  signDigest,
};

/** EIP-191 sign by the validator owner (for the on-chain attestation anchor;
 *  the registry's EOA + ERC-1271 verify paths both use EIP-191). */
export function signAnchorDigest(digest: Hex): Promise<Hex> {
  return owner.signMessage({ message: { raw: digest } });
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
