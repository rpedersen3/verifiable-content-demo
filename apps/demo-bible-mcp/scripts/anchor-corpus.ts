// Anchor the full-BSB corpusRoot (from .data/corpus-meta.json) in the
// agenticprimitives ContentCorpusRegistry on chain. The issuer SA owner signs
// the anchor digest (ERC-1271 via the issuer SA); a relayer submits.
//
//   RPC_URL=$BASE_SEPOLIA_RPC DEPLOYER_PK=0x<funded+issuerOwner> tsx scripts/anchor-corpus.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, getContract, http, keccak256, toBytes, type Abi, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const RPC = process.env.RPC_URL ?? 'http://127.0.0.1:8545';
const OWNER_PK = (process.env.DEPLOYER_PK ?? '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80') as Hex;

const ABI = [
  { type: 'function', name: 'anchorDigest', stateMutability: 'view', inputs: [{ name: 'corpusRef', type: 'bytes32' }, { name: 'corpusRoot', type: 'bytes32' }, { name: 'manifestHash', type: 'bytes32' }, { name: 'issuer', type: 'address' }], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'anchor', stateMutability: 'nonpayable', inputs: [{ name: 'corpusRef', type: 'bytes32' }, { name: 'corpusRoot', type: 'bytes32' }, { name: 'manifestHash', type: 'bytes32' }, { name: 'issuer', type: 'address' }, { name: 'signature', type: 'bytes' }], outputs: [] },
  { type: 'function', name: 'getCorpus', stateMutability: 'view', inputs: [{ name: 'corpusRef', type: 'bytes32' }], outputs: [{ type: 'address' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint64' }] },
] as const satisfies Abi;

async function main() {
  const meta = JSON.parse(readFileSync(join(ROOT, '.data', 'corpus-meta.json'), 'utf8'));
  const dep = JSON.parse(readFileSync(join(ROOT, 'deployments', 'base-sepolia.json'), 'utf8'));
  const registry = dep.contracts.contentCorpusRegistry as Address;
  const issuer = meta.issuer as Address;
  const corpusRef = meta.corpusRef as Hex;
  const corpusRoot = meta.corpusRoot as Hex;
  const manifestHash = keccak256(toBytes(JSON.stringify({ corpusRef, issuer, edition: meta.edition, version: meta.version, corpusRoot })));

  const owner = privateKeyToAccount(OWNER_PK);
  const pub = createPublicClient({ transport: http(RPC) });
  const wallet = createWalletClient({ account: owner, transport: http(RPC) });
  const reg = getContract({ address: registry, abi: ABI, client: { public: pub, wallet } });

  console.log(`anchoring corpusRoot ${corpusRoot} (${meta.leafCount} verses) under ${corpusRef} for issuer ${issuer}`);
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const digest = (await reg.read.anchorDigest([corpusRef, corpusRoot, manifestHash, issuer])) as Hex;
      const sig = await owner.signMessage({ message: { raw: digest } });
      const h = (await reg.write.anchor([corpusRef, corpusRoot, manifestHash, issuer, sig], { account: owner, chain: null })) as Hex;
      await pub.waitForTransactionReceipt({ hash: h });
      const onchain = (await reg.read.getCorpus([corpusRef])) as readonly [Address, Hex, Hex, bigint];
      if (onchain[1].toLowerCase() === corpusRoot.toLowerCase()) {
        console.log(`✓ anchored on-chain (tx ${h})`);
        return;
      }
    } catch (e) {
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  throw new Error('could not anchor corpus root');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
