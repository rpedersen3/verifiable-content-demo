// Trust helpers: turn the dev issuer EOA into a verifiable-credentials
// CredentialSigner, and verify a presented Entitlement VC cryptographically
// (structural + EIP-712 signature) before the policy gate runs.
//
// In production the issuer is a Smart Agent and the signature is checked via
// ERC-1271; here we use EOA recovery. `verifyCredentialStructural` is written
// exactly for this — it returns the digest + proofValue for the consumer to
// check however its issuer signs (spec 242 W1).

import type { Hex } from 'viem';
import type { Address } from '@agenticprimitives/types';
import { verifyCredentialStructural, type CredentialSigner } from '@agenticprimitives/verifiable-credentials';
import type { Entitlement, SignatureVerifier } from '@agenticprimitives/content-primitives';

/** Demo chain id used to anchor the EIP-712 domain (no chain is deployed). */
export const DEMO_CHAIN_ID = 31337;

/** A CredentialSigner backed by a viem LocalAccount (EOA dev path). */
export function eoaCredentialSigner(account: { address: Address; sign: (a: { hash: Hex }) => Promise<Hex> }): CredentialSigner {
  return {
    issuerAddress: account.address,
    chainId: DEMO_CHAIN_ID,
    verifyingContract: account.address, // EOA: the account is its own verifying anchor
    signDigest: (digest: Hex) => account.sign({ hash: digest }),
  };
}

export interface EntitlementCheck {
  ok: boolean;
  reason?: string;
  signer?: Address;
}

/**
 * Cryptographically verify a signed Entitlement VC: structural validity + the
 * issuer's signature over the credential digest, checked by the supplied
 * verifier (EOA recovery in dev, the SA's ERC-1271 on-chain). The
 * corpus/expiry/policy checks remain `evaluateEntitlement`'s job.
 */
export async function verifySignedEntitlement(
  vc: Entitlement,
  expectedIssuer: Address,
  verify: SignatureVerifier,
): Promise<EntitlementCheck> {
  const r = verifyCredentialStructural(vc as unknown as Parameters<typeof verifyCredentialStructural>[0]);
  if (!r.structural) return { ok: false, reason: `entitlement failed structural check: ${r.issues.join('; ')}` };
  if (!r.expectedDigest || !r.proofValue) return { ok: false, reason: 'entitlement has no signature' };
  const ok = await verify({ signer: expectedIssuer, hash: r.expectedDigest, signature: r.proofValue });
  if (!ok) return { ok: false, reason: 'entitlement not validly signed by the corpus issuer' };
  return { ok: true, signer: expectedIssuer };
}
