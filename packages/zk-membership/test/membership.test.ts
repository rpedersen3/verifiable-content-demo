import { describe, it, expect, beforeAll } from 'vitest';
import { keccak256, toHex } from 'viem';
import { buildPoseidonTree, proveMembership, verifyMembership, toField, type PoseidonTree } from '../src/index.js';

// Requires the local trusted setup to have run: `pnpm --filter @verifiable-content-demo/zk-membership setup`.
describe('zk-SNARK Merkle membership (Groth16)', () => {
  let tree: PoseidonTree;
  const leafValues = Array.from({ length: 12 }, (_, i) => toField(keccak256(toHex(`verse-${i}`))));
  const signalHash = toField(keccak256(toHex('response: For God so loved the world...')));

  beforeAll(async () => {
    tree = await buildPoseidonTree(leafValues);
  });

  it('proves + verifies membership of a hidden leaf', async () => {
    const proof = await proveMembership(tree, 5, signalHash);
    // public signals reveal only the root + signalHash — NOT which leaf
    expect(proof.publicSignals[0]).toBe(tree.root.toString());
    expect(await verifyMembership(proof, { root: tree.root, signalHash })).toBe(true);
  }, 60_000);

  it('rejects a proof checked against the wrong root', async () => {
    const proof = await proveMembership(tree, 3, signalHash);
    const wrongRoot = tree.root + 1n;
    expect(await verifyMembership(proof, { root: wrongRoot, signalHash })).toBe(false);
  }, 60_000);

  it('rejects a proof rebound to a different response (signalHash)', async () => {
    const proof = await proveMembership(tree, 7, signalHash);
    const otherSignal = toField(keccak256(toHex('a different response')));
    expect(await verifyMembership(proof, { root: tree.root, signalHash: otherSignal })).toBe(false);
  }, 60_000);
});
