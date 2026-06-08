// Register the demo agents under the .impact TLD (permissionless TLD on the
// agenticprimitives naming registry; the deployer owns the .impact root so it
// registers subnames directly). Reads deployments/base-sepolia.json for the
// contract addresses + the agent SAs/addresses, sets each name's addr record to
// its agent, and confirms resolution. Idempotent + retried (testnet RPC lag).
//
//   RPC_URL=$BASE_SEPOLIA_RPC DEPLOYER_PK=0x<funded> tsx scripts/register-impact-names.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, http, keccak256, toHex, encodePacked, type Abi, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { AgentNamingClient } from '@agenticprimitives/agent-naming';

const HERE = dirname(fileURLToPath(import.meta.url));
const RPC = process.env.RPC_URL ?? 'http://127.0.0.1:8545';
const DEPLOYER_PK = (process.env.DEPLOYER_PK ?? '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80') as Hex;
const TLD = process.env.AGENT_TLD ?? 'impact';

const ZERO = ('0x' + '00'.repeat(32)) as Hex;
const ADDR_PRED = keccak256(toHex('atl:addr'));
const KIND_PRED = keccak256(toHex('atl:agentKind'));
const KIND_SERVICE = keccak256(toHex('service'));

const REGISTRY_ABI = [
  { type: 'function', name: 'recordExists', stateMutability: 'view', inputs: [{ name: 'node', type: 'bytes32' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'register', stateMutability: 'nonpayable',
    inputs: [{ name: 'parentNode', type: 'bytes32' }, { name: 'label', type: 'string' }, { name: 'newOwner', type: 'address' }, { name: 'resolverContract', type: 'address' }, { name: 'expiry', type: 'uint64' }],
    outputs: [{ type: 'bytes32' }] },
] as const satisfies Abi;
const RESOLVER_ABI = [
  { type: 'function', name: 'setAddressAttribute', stateMutability: 'nonpayable', inputs: [{ name: 'n', type: 'bytes32' }, { name: 'p', type: 'bytes32' }, { name: 'v', type: 'address' }], outputs: [] },
  { type: 'function', name: 'setBytes32Attribute', stateMutability: 'nonpayable', inputs: [{ name: 'n', type: 'bytes32' }, { name: 'p', type: 'bytes32' }, { name: 'v', type: 'bytes32' }], outputs: [] },
] as const satisfies Abi;

function namehash(name: string): Hex {
  const labels = name.split('.');
  let node: Hex = ZERO;
  for (let i = labels.length - 1; i >= 0; i--) node = keccak256(encodePacked(['bytes32', 'bytes32'], [node, keccak256(toHex(labels[i]!))]));
  return node;
}

async function retry<T>(fn: () => Promise<T>, label: string, n = 4): Promise<T | null> {
  for (let i = 0; i < n; i++) {
    try {
      return await fn();
    } catch {
      await new Promise((r) => setTimeout(r, 4000));
    }
  }
  console.warn(`  ⚠ ${label} failed after retries (testnet lag) — continuing`);
  return null;
}

async function main() {
  const d = JSON.parse(readFileSync(join(HERE, '..', '..', '..', 'deployments', 'base-sepolia.json'), 'utf8'));
  const registry = d.contracts.agentNameRegistry as Address;
  const resolver = d.contracts.agentNameResolver as Address;
  const deployer = privateKeyToAccount(DEPLOYER_PK);
  const pub = createPublicClient({ transport: http(RPC) });
  const wallet = createWalletClient({ account: deployer, transport: http(RPC) });
  const parent = namehash(TLD);

  const names: { label: string; target: Address; name: string }[] = [
    { label: d.agents.issuer.name.split('.')[0], target: d.agents.issuer.sa, name: d.agents.issuer.name },
    { label: d.agents.validator.name.split('.')[0], target: d.agents.validator.sa, name: d.agents.validator.name },
    { label: d.agents.agent.name.split('.')[0], target: d.agents.agent.address, name: d.agents.agent.name },
  ];

  for (const { label, target, name } of names) {
    const node = namehash(name);
    if (!(await pub.readContract({ address: registry, abi: REGISTRY_ABI, functionName: 'recordExists', args: [node] }))) {
      await retry(async () => {
        const h = await wallet.writeContract({ address: registry, abi: REGISTRY_ABI, functionName: 'register', args: [parent, label, deployer.address, resolver, 0n], account: deployer, chain: null });
        await pub.waitForTransactionReceipt({ hash: h });
      }, `register ${name}`);
    }
    await retry(async () => {
      const h = await wallet.writeContract({ address: resolver, abi: RESOLVER_ABI, functionName: 'setAddressAttribute', args: [node, ADDR_PRED, target], account: deployer, chain: null });
      await pub.waitForTransactionReceipt({ hash: h });
    }, `addr ${name}`);
    await retry(async () => {
      const h = await wallet.writeContract({ address: resolver, abi: RESOLVER_ABI, functionName: 'setBytes32Attribute', args: [node, KIND_PRED, KIND_SERVICE], account: deployer, chain: null });
      await pub.waitForTransactionReceipt({ hash: h });
    }, `kind ${name}`);

    const naming = new AgentNamingClient({ rpcUrl: RPC, chainId: d.chainId, registry, universalResolver: d.contracts.agentNameUniversalResolver });
    const resolved = await naming.resolveName(name).catch(() => null);
    const ok = resolved?.toLowerCase() === target.toLowerCase();
    console.log(`  ${name} → ${target} ${ok ? '✓' : `(resolves to ${resolved} ⚠)`}`);
  }
  console.log('IMPACT NAMES REGISTERED');
}

main().catch((e) => {
  console.error('failed:', e);
  process.exit(1);
});
