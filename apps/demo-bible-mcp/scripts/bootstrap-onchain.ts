// One-shot on-chain bootstrap for the demo's "real trust" mode. Requires the
// agenticprimitives contracts deployed on a running anvil (see README §on-chain).
//
//   1. create an issuer Smart Agent (AgentAccount, mode 0 / single custodian)
//   2. PROVE ERC-1271: sign a digest with the SA's owner, verify via the SA
//   3. register `bsb.agent` → resolves to the issuer SA (agent-naming)
//   4. resolve the name back + write onchain.json for the MCP
//
// Run:  pnpm --filter @verifiable-content-demo/bible-mcp exec tsx scripts/bootstrap-onchain.ts

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toHex,
  encodePacked,
  type Abi,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { AgentAccountClient } from '@agenticprimitives/agent-account';
import { AgentNamingClient } from '@agenticprimitives/agent-naming';
import { buildContentDescriptor, verifyContentDescriptor, contentCommitment } from '@agenticprimitives/content-primitives';
import { parseScriptureAlias, SCRIPTURE_VERSE_CONTENT_TYPE } from '@agenticprimitives/scripture-content-extension';

const HERE = dirname(fileURLToPath(import.meta.url));
const RPC = process.env.RPC_URL ?? 'http://127.0.0.1:8545';
const DEPLOYMENTS =
  process.env.AP_DEPLOYMENTS ?? '/home/barb/agenticprimitives/packages/contracts/deployments-anvil.json';

// Well-known anvil keys (NOT secrets). #0 owns the `.agent` root; #5 owns the issuer SA.
const DEPLOYER_PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
const ISSUER_OWNER_PK = '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba' as const;
const ISSUER_NAME = 'bsb.agent';

const ZERO_NODE = ('0x' + '00'.repeat(32)) as Hex;
const PREDICATE = {
  addr: keccak256(toHex('atl:addr')),
  agentKind: keccak256(toHex('atl:agentKind')),
  displayName: keccak256(toHex('atl:displayName')),
} as const;
const KIND_SERVICE = keccak256(toHex('service'));

const REGISTRY_ABI = [
  { type: 'function', name: 'AGENT_ROOT', stateMutability: 'pure', inputs: [], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'owner', stateMutability: 'view', inputs: [{ name: 'node', type: 'bytes32' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'recordExists', stateMutability: 'view', inputs: [{ name: 'node', type: 'bytes32' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'register', stateMutability: 'nonpayable',
    inputs: [
      { name: 'parentNode', type: 'bytes32' }, { name: 'label', type: 'string' },
      { name: 'newOwner', type: 'address' }, { name: 'resolverContract', type: 'address' }, { name: 'expiry', type: 'uint64' },
    ], outputs: [{ name: 'childNode', type: 'bytes32' }] },
] as const satisfies Abi;
const RESOLVER_ABI = [
  { type: 'function', name: 'setAddressAttribute', stateMutability: 'nonpayable',
    inputs: [{ name: 'node', type: 'bytes32' }, { name: 'predicate', type: 'bytes32' }, { name: 'value', type: 'address' }], outputs: [] },
  { type: 'function', name: 'setStringAttribute', stateMutability: 'nonpayable',
    inputs: [{ name: 'node', type: 'bytes32' }, { name: 'predicate', type: 'bytes32' }, { name: 'value', type: 'string' }], outputs: [] },
  { type: 'function', name: 'setBytes32Attribute', stateMutability: 'nonpayable',
    inputs: [{ name: 'node', type: 'bytes32' }, { name: 'predicate', type: 'bytes32' }, { name: 'value', type: 'bytes32' }], outputs: [] },
  { type: 'function', name: 'addressAttribute', stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }, { name: 'predicate', type: 'bytes32' }], outputs: [{ type: 'address' }] },
] as const satisfies Abi;

function namehash(name: string): Hex {
  if (name === '') return ZERO_NODE;
  const labels = name.split('.');
  let node: Hex = ZERO_NODE;
  for (let i = labels.length - 1; i >= 0; i--) {
    node = keccak256(encodePacked(['bytes32', 'bytes32'], [node, keccak256(toHex(labels[i]!))]));
  }
  return node;
}

async function main() {
  const d = JSON.parse(readFileSync(DEPLOYMENTS, 'utf8'));
  const factory = d.agentAccountFactory as Address;
  const registry = d.agentNameRegistry as Address;
  const resolverAddr = d.agentNameResolver as Address;
  const universal = d.agentNameUniversalResolver as Address;
  const chainId = d.chainId as number;

  const deployer = privateKeyToAccount(DEPLOYER_PK);
  const owner = privateKeyToAccount(ISSUER_OWNER_PK);
  const pub = createPublicClient({ transport: http(RPC) });
  const wallet = createWalletClient({ account: deployer, transport: http(RPC), chain: null });

  // 1. Create the issuer Smart Agent (mode 0, single custodian = owner EOA).
  const aac = new AgentAccountClient({ rpcUrl: RPC, factory, chainId });
  const spec = { mode: 0, custodians: [owner.address], trustees: [] as Address[], salt: 7n };
  const issuerSA = await aac.createAgentAccountFromAccount(spec, owner);
  console.log(`issuer Smart Agent: ${issuerSA} (owner ${owner.address})`);

  // 2. PROVE ERC-1271 — sign a digest with the owner, verify via the SA.
  const sampleHash = keccak256(toHex('content-primitives:erc1271-probe'));
  const sig = await owner.signMessage({ message: { raw: sampleHash } });
  const erc1271 = await aac.isValidSignature(issuerSA, sampleHash, sig);
  console.log(`ERC-1271 isValidSignature: ${erc1271 ? 'OK ✓' : 'FAILED ✗'}`);
  if (!erc1271) throw new Error('ERC-1271 verification failed — issuer SA cannot sign');

  // 3. Register bsb.agent (owned by deployer) → resolves to the issuer SA.
  const agentRoot = await pub.readContract({ address: registry, abi: REGISTRY_ABI, functionName: 'AGENT_ROOT' });
  const node = namehash(ISSUER_NAME);
  if (!(await pub.readContract({ address: registry, abi: REGISTRY_ABI, functionName: 'recordExists', args: [node] }))) {
    const h = await wallet.writeContract({
      address: registry, abi: REGISTRY_ABI, functionName: 'register',
      args: [agentRoot, 'bsb', deployer.address, resolverAddr, 4102444800n], account: deployer, chain: null,
    });
    await pub.waitForTransactionReceipt({ hash: h });
  }
  for (const call of [
    { fn: 'setAddressAttribute', args: [node, PREDICATE.addr, issuerSA] },
    { fn: 'setStringAttribute', args: [node, PREDICATE.displayName, 'Berean Standard Bible publisher'] },
    { fn: 'setBytes32Attribute', args: [node, PREDICATE.agentKind, KIND_SERVICE] },
  ] as const) {
    const h = await wallet.writeContract({ address: resolverAddr, abi: RESOLVER_ABI, functionName: call.fn, args: call.args as never, account: deployer, chain: null });
    await pub.waitForTransactionReceipt({ hash: h });
  }

  // 4. Resolve the name back through agent-naming → must equal the issuer SA.
  const naming = new AgentNamingClient({ rpcUrl: RPC, chainId, registry, universalResolver: universal });
  const resolved = await naming.resolveName(ISSUER_NAME);
  console.log(`${ISSUER_NAME} resolves to: ${resolved} ${resolved?.toLowerCase() === issuerSA.toLowerCase() ? '✓' : '✗ MISMATCH'}`);
  if (resolved?.toLowerCase() !== issuerSA.toLowerCase()) throw new Error('name does not resolve to issuer SA');

  // 4b. FULL content-trust round-trip: build a real ContentDescriptor for the
  //     agent-naming-resolved issuer SA, sign it via the SA (ERC-1271 format),
  //     and verify it through content-primitives against the SA's isValidSignature.
  const issuerSAResolved = resolved; // from agent-naming, == issuerSA
  const ref = parseScriptureAlias('John 3:16');
  const descriptor = await buildContentDescriptor(
    {
      id: 'desc_onchain_john_3_16',
      canonicalId: ref.reference.id,
      contentType: SCRIPTURE_VERSE_CONTENT_TYPE,
      issuer: { address: issuerSAResolved, did: `agent:${ISSUER_NAME}` },
      issuedAt: new Date().toISOString(),
      status: 'active',
      selector: ref.selector as unknown as Record<string, unknown>,
      commitment: contentCommitment('For God so loved the world …'),
      retrievalPointer: `content://${SCRIPTURE_VERSE_CONTENT_TYPE}/bsb/John.3.16`,
      proofPolicy: 'issuer-signature-and-hash-v1',
      accessPolicy: 'public',
    },
    (hash) => owner.signMessage({ message: { raw: hash } }), // SA owner → ERC-1271-format sig
  );
  const v = await verifyContentDescriptor(descriptor, {
    verifySignature: ({ signer, hash, signature }) => aac.isValidSignature(signer, hash, signature),
  });
  console.log(`ContentDescriptor verified via SA ERC-1271: ${v.ok ? 'OK ✓' : `FAILED ✗ (${v.reason})`}`);
  if (!v.ok) throw new Error(`on-chain descriptor verification failed: ${v.reason}`);

  // 5. Write the config the MCP reads in on-chain mode.
  const cfg = { rpcUrl: RPC, chainId, factory, registry, resolverAddr, universalResolver: universal, issuerName: ISSUER_NAME, issuerSA, ownerPrivateKey: ISSUER_OWNER_PK };
  writeFileSync(join(HERE, '..', 'onchain.json'), JSON.stringify(cfg, null, 2));
  console.log('\nwrote apps/demo-bible-mcp/onchain.json — set TRUST_MODE=onchain to use it.');
  console.log('ON-CHAIN BOOTSTRAP OK');
}

main().catch((e) => {
  console.error('bootstrap failed:', e);
  process.exit(1);
});
