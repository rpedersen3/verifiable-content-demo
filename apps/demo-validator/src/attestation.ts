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

const OWNER_PK = (process.env.VALIDATOR_OWNER_PK ?? process.env.VALIDATOR_SIGNER_PK ?? '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6') as Hex;
const owner = privateKeyToAccount(OWNER_PK);
const SA = process.env.VALIDATOR_SA as Address | undefined;

export const IS_SA = !!SA;
export const VALIDATOR_ADDRESS = (SA ?? owner.address) as Address;
export const VALIDATOR_CHAIN_ID = Number(process.env.VALIDATOR_CHAIN_ID ?? 84532);
export const VALIDATOR_AGENT_ID = `eip155:${VALIDATOR_CHAIN_ID}:${VALIDATOR_ADDRESS}`;
export const VALIDATOR_NAME = process.env.VALIDATOR_NAME ?? 'demo-validator.agent';

// SA → owner signs EIP-191 (ERC-1271 validates); EOA → sign raw (recover validates).
const signDigest = SA ? (hash: Hex) => owner.signMessage({ message: { raw: hash } }) : (hash: Hex) => owner.sign({ hash });

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
  return signCredential(unsigned, credentialSigner);
}
