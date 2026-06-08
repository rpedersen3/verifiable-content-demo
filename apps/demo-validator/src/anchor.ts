// Phase 6 — anchor the signed ValidationAttestation in the on-chain
// ValidationAttestationRegistry (compact facts; full evidence stays off-chain).
// Env-gated: needs ATTESTATION_REGISTRY + VALIDATOR_ANCHOR_PK (a funded relayer)
// + VALIDATOR_RPC_URL. The validator EOA signs the anchor digest; the relayer
// pays gas. Best-effort — validation never fails because anchoring did.

import { createPublicClient, createWalletClient, getContract, http, keccak256, toBytes, type Abi, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { signAnchorDigest, VALIDATOR_ADDRESS } from './attestation.js';

const ABI = [
  { type: 'function', name: 'anchorDigest', stateMutability: 'view',
    inputs: [{ name: 'attestationHash', type: 'bytes32' }, { name: 'validator', type: 'address' }, { name: 'subjectAgent', type: 'bytes32' }, { name: 'profileId', type: 'bytes32' }, { name: 'outcome', type: 'uint8' }, { name: 'expiresAt', type: 'uint64' }],
    outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'anchor', stateMutability: 'nonpayable',
    inputs: [{ name: 'attestationHash', type: 'bytes32' }, { name: 'validator', type: 'address' }, { name: 'subjectAgent', type: 'bytes32' }, { name: 'profileId', type: 'bytes32' }, { name: 'outcome', type: 'uint8' }, { name: 'expiresAt', type: 'uint64' }, { name: 'signature', type: 'bytes' }],
    outputs: [] },
  { type: 'function', name: 'isValid', stateMutability: 'view', inputs: [{ name: 'attestationHash', type: 'bytes32' }], outputs: [{ type: 'bool' }] },
] as const satisfies Abi;

const OUTCOME: Record<string, number> = { rejected: 0, gated: 1, validated: 2 };

export interface AnchorResult {
  onchain: boolean;
  attestationHash: Hex;
  registry: Address;
  chainId: number;
  txHash?: Hex;
  alreadyAnchored?: boolean;
}

export async function anchorAttestation(attestation: unknown, opts: { subjectAgentId: string; profile: string; outcome: string }): Promise<AnchorResult | null> {
  const registry = process.env.ATTESTATION_REGISTRY as Address | undefined;
  const relayerPk = process.env.VALIDATOR_ANCHOR_PK as Hex | undefined;
  const rpcUrl = process.env.VALIDATOR_RPC_URL;
  if (!registry || !relayerPk || !rpcUrl) return null; // anchoring disabled

  const chainId = Number(process.env.VALIDATOR_CHAIN_ID ?? 84532);
  const attestationHash = keccak256(toBytes(JSON.stringify(attestation)));
  const subjectAgent = keccak256(toBytes(opts.subjectAgentId));
  const profileId = keccak256(toBytes(opts.profile));
  const outcome = OUTCOME[opts.outcome] ?? 0;

  const pub = createPublicClient({ transport: http(rpcUrl) });
  const reg = getContract({ address: registry, abi: ABI, client: pub });
  if (await reg.read.isValid([attestationHash])) {
    return { onchain: true, attestationHash, registry, chainId, alreadyAnchored: true };
  }

  const relayer = privateKeyToAccount(relayerPk);
  const wallet = createWalletClient({ account: relayer, transport: http(rpcUrl) });
  const digest = (await reg.read.anchorDigest([attestationHash, VALIDATOR_ADDRESS, subjectAgent, profileId, outcome, 0n])) as Hex;
  const signature = await signAnchorDigest(digest);
  const txHash = await wallet.writeContract({ address: registry, abi: ABI, functionName: 'anchor', args: [attestationHash, VALIDATOR_ADDRESS, subjectAgent, profileId, outcome, 0n, signature], account: relayer, chain: null });
  await pub.waitForTransactionReceipt({ hash: txHash });
  return { onchain: true, attestationHash, registry, chainId, txHash };
}
