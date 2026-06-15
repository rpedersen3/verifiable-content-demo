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
  verifyDelegatedAuthority?: (a: { delegatorIssuer: Address; delegateKey: Address; delegationLeaf: unknown }) => Promise<boolean> | boolean,
): Promise<EntitlementCheck> {
  const r = verifyCredentialStructural(vc as unknown as Parameters<typeof verifyCredentialStructural>[0]);
  if (!r.structural) return { ok: false, reason: `entitlement failed structural check: ${r.issues.join('; ')}` };
  if (!r.expectedDigest || !r.proofValue) return { ok: false, reason: 'entitlement has no signature' };
  // Delegated grants: signed by an issuer-AUTHORIZED key. Verify the leaf (delegate authorized by the
  // expected issuer SA) + the delegate's signature. Trust still roots in `expectedIssuer`.
  const ds = ((vc as { proof?: { delegatingSigner?: { delegatorIssuer?: Address; delegateKey?: Address; delegationLeaf?: unknown } } }).proof)?.delegatingSigner;
  if (ds?.delegateKey && ds.delegatorIssuer) {
    if (ds.delegatorIssuer.toLowerCase() !== expectedIssuer.toLowerCase()) return { ok: false, reason: 'grant delegatorIssuer ≠ corpus issuer' };
    if (!verifyDelegatedAuthority) return { ok: false, reason: 'grant is delegate-signed but no delegated-authority verifier provided' };
    const authOk = await verifyDelegatedAuthority({ delegatorIssuer: ds.delegatorIssuer, delegateKey: ds.delegateKey, delegationLeaf: ds.delegationLeaf });
    if (!authOk) return { ok: false, reason: 'issuer did not authorize the grant signing key' };
    const sigOk = await verify({ signer: ds.delegateKey, hash: r.expectedDigest, signature: r.proofValue });
    if (!sigOk) return { ok: false, reason: 'grant delegate-key signature did not verify' };
    return { ok: true, signer: expectedIssuer };
  }
  const ok = await verify({ signer: expectedIssuer, hash: r.expectedDigest, signature: r.proofValue });
  if (!ok) return { ok: false, reason: 'entitlement not validly signed by the corpus issuer' };
  return { ok: true, signer: expectedIssuer };
}
