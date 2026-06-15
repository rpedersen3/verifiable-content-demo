// Env-gated on-chain signature verifier. When VALIDATOR_RPC_URL is set,
// descriptor/entitlement signatures are verified via the issuer Smart Agent's
// ERC-1271 isValidSignature (matching the live on-chain MCP) — a plain viem
// readContract (no agent-account dep, so it bundles cleanly on serverless).
// Otherwise the validator uses EOA recovery (dev bundles).

import { createPublicClient, http, recoverAddress, type Address, type Hex } from 'viem';
import { hashDelegation } from '@agenticprimitives/delegation';
import type { SignatureVerifier, DelegatedAuthorityVerifier } from '@agenticprimitives/content-primitives';

// spec 266 — the DelegationManager the home ceremony signed each issuer→KMS-key leaf against.
const DEFAULT_DELEGATION_MANAGER = '0x3a8E2cE74564f699b135db6f266ccDb563979C05';

const ERC1271_ABI = [
  {
    type: 'function',
    name: 'isValidSignature',
    stateMutability: 'view',
    inputs: [
      { name: 'hash', type: 'bytes32' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [{ type: 'bytes4' }],
  },
] as const;
const ERC1271_MAGIC = '0x1626ba7e';

export function makeOnchainVerifier(): SignatureVerifier | undefined {
  const rpcUrl = process.env.VALIDATOR_RPC_URL;
  if (!rpcUrl) return undefined;
  const pub = createPublicClient({ transport: http(rpcUrl) });
  return async ({ signer, hash, signature }) => {
    // spec 266 delegated mode: descriptors are signed by an EOA KMS delegate key (recoverable secp256k1) —
    // try EOA recovery first, then fall back to the issuer Smart Agent's ERC-1271.
    try { if ((await recoverAddress({ hash, signature })).toLowerCase() === signer.toLowerCase()) return true; } catch { /* not an EOA sig */ }
    try {
      const r = (await pub.readContract({
        address: signer as Address,
        abi: ERC1271_ABI,
        functionName: 'isValidSignature',
        args: [hash as Hex, signature as Hex],
      })) as Hex;
      return r === ERC1271_MAGIC;
    } catch {
      return false;
    }
  };
}

// spec 266 — independently verify the issuer→KMS-key authorization: the leaf must bind delegatorIssuer→delegateKey
// and the ISSUER Smart Agent must have signed hashDelegation(leaf) (ERC-1271). Lets the validator trust a
// delegate-signed descriptor without the issuer's key ever being held anywhere. Needs VALIDATOR_RPC_URL.
export function makeDelegatedAuthorityVerifier(): DelegatedAuthorityVerifier | undefined {
  const rpcUrl = process.env.VALIDATOR_RPC_URL;
  if (!rpcUrl) return undefined;
  const delegationManager = (process.env.VALIDATOR_DELEGATION_MANAGER ?? DEFAULT_DELEGATION_MANAGER) as Address;
  const chainId = Number(process.env.VALIDATOR_CHAIN_ID ?? 84532);
  const pub = createPublicClient({ transport: http(rpcUrl) });
  return async ({ delegatorIssuer, delegateKey, delegationLeaf }) => {
    try {
      const leaf = delegationLeaf as { delegator?: string; delegate?: string; signature?: Hex };
      if (!leaf?.delegator || !leaf?.delegate || !leaf?.signature) return false;
      if (leaf.delegator.toLowerCase() !== delegatorIssuer.toLowerCase()) return false;
      if (leaf.delegate.toLowerCase() !== delegateKey.toLowerCase()) return false;
      const leafHash = hashDelegation(leaf as Parameters<typeof hashDelegation>[0], chainId, delegationManager);
      const r = (await pub.readContract({
        address: delegatorIssuer as Address,
        abi: ERC1271_ABI,
        functionName: 'isValidSignature',
        args: [leafHash as Hex, leaf.signature as Hex],
      })) as Hex;
      return r === ERC1271_MAGIC;
    } catch {
      return false;
    }
  };
}
