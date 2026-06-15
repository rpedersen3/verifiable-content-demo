// Env-gated on-chain verification for the independent validator.
//
// - makeOnchainVerifier: descriptor/entitlement signatures. EOA recovery (delegate KMS keys, spec 266)
//   first, then the issuer Smart Agent's ERC-1271 isValidSignature (matching the live MCP). Plain viem
//   readContract (no agent-account dep) so it bundles cleanly on serverless.
// - makeDelegatedAuthorityVerifier: independently re-checks the issuer→KMS-key authorization (the leaf
//   binds delegator→delegate AND the issuer SA signed hashDelegation(leaf) via ERC-1271). So a
//   delegate-signed descriptor is trusted without the issuer's key being held anywhere.
//
// Both no-op (return undefined → EOA-recovery fallback / delegated checks fail) unless VALIDATOR_RPC_URL.

import { createPublicClient, http, recoverAddress, hashTypedData, type Address, type Hex } from 'viem';
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

// Inlined EIP-712 Delegation hashing — avoids @agenticprimitives/delegation (whose heavy peerDeps break
// `npm install` on Vercel). MUST byte-match AgentDelegationManager: domain name "AgentDelegationManager"
// version "1"; the Caveat hash covers (enforcer, terms) ONLY — `args` is runtime-only, never signed.
const DELEGATION_EIP712_TYPES = {
  Delegation: [
    { name: 'delegator', type: 'address' },
    { name: 'delegate', type: 'address' },
    { name: 'authority', type: 'bytes32' },
    { name: 'caveats', type: 'Caveat[]' },
    { name: 'salt', type: 'uint256' },
  ],
  Caveat: [
    { name: 'enforcer', type: 'address' },
    { name: 'terms', type: 'bytes' },
  ],
} as const;

interface DelegationLeaf {
  delegator: Address;
  delegate: Address;
  authority: Hex;
  caveats: { enforcer: Address; terms: Hex; args?: Hex }[];
  salt: string | number | bigint;
  signature: Hex;
}

function hashDelegation(d: DelegationLeaf, chainId: number, delegationManager: Address): Hex {
  return hashTypedData({
    domain: { name: 'AgentDelegationManager', version: '1', chainId, verifyingContract: delegationManager },
    types: DELEGATION_EIP712_TYPES,
    primaryType: 'Delegation',
    message: {
      delegator: d.delegator,
      delegate: d.delegate,
      authority: d.authority,
      caveats: (d.caveats ?? []).map((c) => ({ enforcer: c.enforcer, terms: c.terms })),
      salt: BigInt(d.salt),
    },
  });
}

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

export function makeDelegatedAuthorityVerifier(): DelegatedAuthorityVerifier | undefined {
  const rpcUrl = process.env.VALIDATOR_RPC_URL;
  if (!rpcUrl) return undefined;
  const delegationManager = (process.env.VALIDATOR_DELEGATION_MANAGER ?? DEFAULT_DELEGATION_MANAGER) as Address;
  const chainId = Number(process.env.VALIDATOR_CHAIN_ID ?? 84532);
  const pub = createPublicClient({ transport: http(rpcUrl) });
  return async ({ delegatorIssuer, delegateKey, delegationLeaf }) => {
    try {
      const leaf = delegationLeaf as DelegationLeaf;
      if (!leaf?.delegator || !leaf?.delegate || !leaf?.signature) return false;
      if (leaf.delegator.toLowerCase() !== delegatorIssuer.toLowerCase()) return false;
      if (leaf.delegate.toLowerCase() !== delegateKey.toLowerCase()) return false;
      const leafHash = hashDelegation(leaf, chainId, delegationManager);
      const r = (await pub.readContract({
        address: delegatorIssuer as Address,
        abi: ERC1271_ABI,
        functionName: 'isValidSignature',
        args: [leafHash, leaf.signature],
      })) as Hex;
      return r === ERC1271_MAGIC;
    } catch {
      return false;
    }
  };
}
