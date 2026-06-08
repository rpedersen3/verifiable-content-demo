// Env-gated on-chain signature verifier. When VALIDATOR_RPC_URL is set,
// descriptor/entitlement signatures are verified via the issuer Smart Agent's
// ERC-1271 isValidSignature (matching the live on-chain MCP) — a plain viem
// readContract (no agent-account dep, so it bundles cleanly on serverless).
// Otherwise the validator uses EOA recovery (dev bundles).

import { createPublicClient, http, type Address, type Hex } from 'viem';
import type { SignatureVerifier } from '@agenticprimitives/content-primitives';

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
