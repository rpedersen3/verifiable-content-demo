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
  getContract,
  http,
  keccak256,
  toHex,
  toBytes,
  encodePacked,
  type Abi,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { AgentAccountClient } from '@agenticprimitives/agent-account';
import { AgentNamingClient } from '@agenticprimitives/agent-naming';
import { buildContentDescriptor, verifyContentDescriptor, contentCommitment, corpusRef as makeCorpusRef, leafHash, merkleRoot } from '@agenticprimitives/content-primitives';
import { parseScriptureAlias, SCRIPTURE_VERSE_CONTENT_TYPE } from '@agenticprimitives/scripture-content-extension';
import { EDITIONS } from '../src/editions/registry.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const RPC = process.env.RPC_URL ?? 'http://127.0.0.1:8545';
const DEPLOYMENTS =
  process.env.AP_DEPLOYMENTS ?? '/home/barb/agenticprimitives/packages/contracts/deployments-anvil.json';

// Default to well-known anvil keys (#0 owns the `.agent` root; #5 owns the issuer
// SA). Override with DEPLOYER_PK / ISSUER_OWNER_PK env for a real testnet (e.g.
// Base Sepolia — use the funded deployer key for both).
const DEPLOYER_PK = (process.env.DEPLOYER_PK ?? '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80') as Hex;
const ISSUER_OWNER_PK = (process.env.ISSUER_OWNER_PK ?? '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba') as Hex;
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

const CONTENT_CORPUS_ABI = [
  { type: 'function', name: 'anchorDigest', stateMutability: 'view',
    inputs: [{ name: 'corpusRef', type: 'bytes32' }, { name: 'corpusRoot', type: 'bytes32' }, { name: 'manifestHash', type: 'bytes32' }, { name: 'issuer', type: 'address' }],
    outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'anchor', stateMutability: 'nonpayable',
    inputs: [{ name: 'corpusRef', type: 'bytes32' }, { name: 'corpusRoot', type: 'bytes32' }, { name: 'manifestHash', type: 'bytes32' }, { name: 'issuer', type: 'address' }, { name: 'signature', type: 'bytes' }],
    outputs: [] },
  { type: 'function', name: 'getCorpus', stateMutability: 'view',
    inputs: [{ name: 'corpusRef', type: 'bytes32' }],
    outputs: [{ type: 'address' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint64' }] },
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

  // Wait for the SA deploy to confirm (testnet blocks aren't instant like anvil).
  for (let i = 0; i < 30; i++) {
    const code = await pub.getCode({ address: issuerSA });
    if (code && code.length > 2) break;
    await new Promise((r) => setTimeout(r, 2000));
  }

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
  // Resolver records (discovery layer) — best-effort: public testnet RPCs lag
  // sequential writes, and these aren't required for on-chain trust (the SA +
  // ERC-1271 + on-chain corpus root are). Retry a couple times, then warn.
  for (const call of [
    { fn: 'setAddressAttribute', args: [node, PREDICATE.addr, issuerSA] },
    { fn: 'setStringAttribute', args: [node, PREDICATE.displayName, 'Berean Standard Bible publisher'] },
    { fn: 'setBytes32Attribute', args: [node, PREDICATE.agentKind, KIND_SERVICE] },
  ] as const) {
    let done = false;
    for (let attempt = 0; attempt < 3 && !done; attempt++) {
      try {
        const h = await wallet.writeContract({ address: resolverAddr, abi: RESOLVER_ABI, functionName: call.fn, args: call.args as never, account: deployer, chain: null });
        await pub.waitForTransactionReceipt({ hash: h });
        done = true;
      } catch {
        await new Promise((r) => setTimeout(r, 4000));
      }
    }
    if (!done) console.warn(`  ⚠ ${call.fn} record not set (testnet RPC lag) — continuing`);
  }

  // 4. Resolve the name back through agent-naming. The SA + ERC-1271 + on-chain
  //    corpus root are the core trust; agent-naming is the discovery layer and is
  //    best-effort (public testnet RPCs lag forward records) — warn, don't fail.
  const naming = new AgentNamingClient({ rpcUrl: RPC, chainId, registry, universalResolver: universal });
  const resolved = await naming.resolveName(ISSUER_NAME).catch(() => null);
  const nameOk = resolved?.toLowerCase() === issuerSA.toLowerCase();
  console.log(`${ISSUER_NAME} resolves to: ${resolved} ${nameOk ? '✓' : '⚠ best-effort (using ISSUER_SA directly)'}`);

  // 4b. FULL content-trust round-trip: build a real ContentDescriptor for the
  //     issuer SA, sign it via the SA (ERC-1271 format), and verify it through
  //     content-primitives against the SA's isValidSignature.
  const issuerSAResolved = issuerSA;
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

  // 4c. Phase 3 — ANCHOR each edition's Merkle corpusRoot on chain via the
  //     agenticprimitives ContentCorpusRegistry (deployed by the AP deploy; read
  //     from deployments-anvil.json). The issuer SA signs the anchor digest via
  //     ERC-1271. Verifiers then read the root from chain, not the off-chain manifest.
  const contentRegistry = d.contentCorpusRegistry as Address;
  if (!contentRegistry) throw new Error('contentCorpusRegistry missing from deployments — redeploy AP contracts');
  const reg = getContract({ address: contentRegistry, abi: CONTENT_CORPUS_ABI, client: { public: pub, wallet } });
  console.log(`ContentCorpusRegistry (agenticprimitives): ${contentRegistry}`);
  for (const e of EDITIONS) {
    const cRef = makeCorpusRef(issuerSA, e.edition, e.version);
    const osisPaths = Object.keys(e.texts).sort();
    const root = merkleRoot(osisPaths.map((o) => leafHash(contentCommitment(e.texts[o]!).value)));
    const manifestHash = keccak256(toBytes(JSON.stringify({ corpusRef: cRef, issuer: issuerSA, edition: e.edition, version: e.version, corpusRoot: root })));
    const manifest = manifestHash;
    let anchored = false;
    for (let attempt = 0; attempt < 4 && !anchored; attempt++) {
      try {
        const digest = (await reg.read.anchorDigest([cRef, root, manifest, issuerSA])) as Hex;
        const anchorSig = await owner.signMessage({ message: { raw: digest } });
        const h = (await reg.write.anchor([cRef, root, manifest, issuerSA, anchorSig], { account: deployer, chain: null })) as Hex;
        await pub.waitForTransactionReceipt({ hash: h });
        const onchain = (await reg.read.getCorpus([cRef])) as readonly [Address, Hex, Hex, bigint];
        anchored = onchain[1].toLowerCase() === root.toLowerCase();
      } catch {
        await new Promise((r) => setTimeout(r, 5000)); // testnet RPC/state lag
      }
    }
    console.log(`  anchored ${e.edition}: corpusRoot ${root.slice(0, 12)}… on-chain ${anchored ? '✓' : '✗ FAILED'}`);
    if (!anchored) throw new Error(`could not anchor corpusRoot for ${e.edition}`);
  }

  // 5. Write the config the MCP reads in on-chain mode (onchain.json for
  //    reference + .dev.vars so `wrangler dev` injects it into the Worker).
  const entryPoint = d.entryPoint as Address;
  const cfg = { rpcUrl: RPC, chainId, factory, registry, resolverAddr, universalResolver: universal, entryPoint, contentRegistry, issuerName: ISSUER_NAME, issuerSA, ownerPrivateKey: ISSUER_OWNER_PK };
  writeFileSync(join(HERE, '..', 'onchain.json'), JSON.stringify(cfg, null, 2));
  const devVars = [
    'TRUST_MODE=onchain',
    `RPC_URL=${RPC}`,
    `CHAIN_ID=${chainId}`,
    `FACTORY=${factory}`,
    `ENTRY_POINT=${entryPoint}`,
    `REGISTRY=${registry}`,
    `UNIVERSAL_RESOLVER=${universal}`,
    `CONTENT_REGISTRY=${contentRegistry}`,
    `ISSUER_NAME=${ISSUER_NAME}`,
    `ISSUER_SA=${issuerSA}`,
    `ISSUER_OWNER_PK=${ISSUER_OWNER_PK}`,
    '',
  ].join('\n');
  writeFileSync(join(HERE, '..', '.dev.vars'), devVars);
  console.log('\nwrote onchain.json + .dev.vars — restart `pnpm dev:mcp` for on-chain mode.');
  console.log('ON-CHAIN BOOTSTRAP OK');
}

main().catch((e) => {
  console.error('bootstrap failed:', e);
  process.exit(1);
});
