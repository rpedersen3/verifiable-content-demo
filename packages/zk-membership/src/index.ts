// Real Groth16 zk-SNARK membership: prove a content commitment (a leaf) is in an
// issuer's Poseidon Merkle corpus WITHOUT revealing which leaf. The corpus root +
// a response-binding signalHash are PUBLIC; the leaf + path are PRIVATE.
//
// The Poseidon tree here mirrors the circuit's Poseidon(2) exactly (circomlibjs
// uses the same constants as circomlib's poseidon.circom), so a JS-built root
// verifies against a circuit-produced proof.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildPoseidon } from 'circomlibjs';
import * as snarkjs from 'snarkjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUILD = join(HERE, '..', 'build');
export const TREE_DEPTH = 4; // 16 leaves — matches circuits/merkle.circom
export const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/** Reduce a 0x-hex value (e.g. a SHA-256 commitment) into the BN254 scalar field. */
export function toField(hex: string): bigint {
  return BigInt(hex) % FIELD;
}

type Poseidon = Awaited<ReturnType<typeof buildPoseidon>>;
let _poseidon: Poseidon | null = null;
async function poseidon(): Promise<Poseidon> {
  if (!_poseidon) _poseidon = await buildPoseidon();
  return _poseidon;
}

export interface PoseidonTree {
  root: bigint;
  depth: number;
  leaves: bigint[]; // padded to 2^depth
  layers: bigint[][];
}

/** Build a fixed-depth Poseidon Merkle tree, zero-padded to 2^depth leaves. */
export async function buildPoseidonTree(rawLeaves: bigint[], depth = TREE_DEPTH): Promise<PoseidonTree> {
  const p = await poseidon();
  const hash2 = (a: bigint, b: bigint) => BigInt(p.F.toObject(p([a, b])));
  const size = 1 << depth;
  if (rawLeaves.length > size) throw new Error(`too many leaves: ${rawLeaves.length} > ${size}`);
  const leaves = [...rawLeaves, ...Array(size - rawLeaves.length).fill(0n)];

  const layers: bigint[][] = [leaves];
  let cur = leaves;
  for (let d = 0; d < depth; d++) {
    const next: bigint[] = [];
    for (let i = 0; i < cur.length; i += 2) next.push(hash2(cur[i]!, cur[i + 1]!));
    layers.push(next);
    cur = next;
  }
  return { root: cur[0]!, depth, leaves, layers };
}

export interface MerklePath {
  pathElements: bigint[];
  pathIndices: number[];
}

/** Authentication path for `index` (pathIndices[i]=0 → node is the LEFT input). */
export function membershipPath(tree: PoseidonTree, index: number): MerklePath {
  const pathElements: bigint[] = [];
  const pathIndices: number[] = [];
  let idx = index;
  for (let d = 0; d < tree.depth; d++) {
    const isRight = idx & 1;
    const sibling = tree.layers[d]![isRight ? idx - 1 : idx + 1]!;
    pathElements.push(sibling);
    pathIndices.push(isRight); // 1 if current node is the right child
    idx >>= 1;
  }
  return { pathElements, pathIndices };
}

export interface MembershipProof {
  proof: unknown;
  publicSignals: string[]; // [root, signalHash]
}

/**
 * Prove `leaves[index]` is a member of the tree, in zero knowledge, bound to
 * `signalHash` (a field-reduced response hash). Returns the Groth16 proof +
 * the public signals (root, signalHash) — NOT the leaf or its index.
 */
export async function proveMembership(tree: PoseidonTree, index: number, signalHash: bigint): Promise<MembershipProof> {
  const path = membershipPath(tree, index);
  const input = {
    root: tree.root.toString(),
    signalHash: signalHash.toString(),
    leaf: tree.leaves[index]!.toString(),
    pathElements: path.pathElements.map((x) => x.toString()),
    pathIndices: path.pathIndices.map((x) => x.toString()),
  };
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, join(BUILD, 'merkle.wasm'), join(BUILD, 'merkle.zkey'));
  return { proof, publicSignals };
}

let _vkey: unknown = null;
export function verificationKey(): unknown {
  if (!_vkey) _vkey = JSON.parse(readFileSync(join(BUILD, 'verification_key.json'), 'utf8'));
  return _vkey;
}

/** Verify a Groth16 membership proof against an EXPECTED public root + signalHash. */
export async function verifyMembership(p: MembershipProof, expected: { root: bigint; signalHash: bigint }): Promise<boolean> {
  // bind the proof to the root + response we expect (public signal order: root, signalHash)
  if (p.publicSignals[0] !== expected.root.toString()) return false;
  if (p.publicSignals[1] !== expected.signalHash.toString()) return false;
  return snarkjs.groth16.verify(verificationKey(), p.publicSignals, p.proof);
}
