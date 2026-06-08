# @verifiable-content-demo/zk-membership

A **real Groth16 zk-SNARK** that proves a content commitment (a leaf) is a member
of an issuer's Merkle corpus **without revealing which leaf** — Phase 4 of the
Verifiable Content Substrate (spec 266 §6). The circuit's only public inputs are
the **corpus root** and a **response-binding `signalHash`**; the leaf and its
authentication path stay private.

```
circuits/merkle.circom   Poseidon(2) Merkle membership, depth 4, + signalHash binding
scripts/setup.sh         circom compile + local Groth16 trusted setup (snarkjs)
src/index.ts             buildPoseidonTree / proveMembership / verifyMembership
```

## Use

```bash
# one-time: compile + local trusted-setup ceremony (writes build/*, gitignored)
pnpm --filter @verifiable-content-demo/zk-membership setup
pnpm --filter @verifiable-content-demo/zk-membership test
```

```ts
const tree = await buildPoseidonTree(corpusCommitments.map(toField));
const proof = await proveMembership(tree, citedIndex, toField(responseHash));
// proof.publicSignals === [root, signalHash] — NOT the leaf or its index
await verifyMembership(proof, { root: tree.root, signalHash }); // true
```

A third-party validator derives the Poseidon root from the issuer's published
corpus commitments and verifies the proof against it — confirming the agent
referenced *something authentic in the authorized corpus* while learning nothing
about which item (query privacy). Requires `circom` on PATH; the setup is a
demo-only single-party ceremony (production would use a multi-party ceremony).
