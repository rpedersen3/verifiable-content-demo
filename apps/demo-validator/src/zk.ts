// Self-contained zk membership VERIFY (no workspace dep → Vercel-friendly). The
// Poseidon tree mirrors the circuit; the vkey is the committed canonical setup.

import { VKEY } from './vkey.js';

// Lazy-load the heavy zk libs (snarkjs/circomlibjs pull in wasm/worker code that
// can break serverless module-init). Imported on first use, then cached.
type BuildPoseidon = () => Promise<{ (i: bigint[]): unknown; F: { toObject(x: unknown): bigint } }>;
let _buildPoseidon: BuildPoseidon | null = null;
async function getBuildPoseidon(): Promise<BuildPoseidon> {
  if (!_buildPoseidon) _buildPoseidon = (await import('circomlibjs')).buildPoseidon as unknown as BuildPoseidon;
  return _buildPoseidon;
}
let _groth16: { verify(v: unknown, p: string[], pr: unknown): Promise<boolean> } | null = null;
async function getGroth16() {
  if (!_groth16) _groth16 = ((await import('snarkjs')) as unknown as { groth16: typeof _groth16 }).groth16!;
  return _groth16;
}

export const TREE_DEPTH = 4;
export const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/** Reduce a 0x-hex value (e.g. a SHA-256 commitment) into the BN254 scalar field. */
export function toField(hex: string): bigint {
  return BigInt(hex) % FIELD;
}

type Poseidon = Awaited<ReturnType<BuildPoseidon>>;
let _p: Poseidon | null = null;
async function poseidon(): Promise<Poseidon> {
  if (!_p) _p = await (await getBuildPoseidon())();
  return _p;
}

/** Poseidon Merkle root over zero-padded leaves (matches the prover's tree). */
export async function poseidonRoot(rawLeaves: bigint[], depth = TREE_DEPTH): Promise<bigint> {
  const p = await poseidon();
  const h2 = (a: bigint, b: bigint) => BigInt(p.F.toObject(p([a, b])));
  const size = 1 << depth;
  const leaves = [...rawLeaves, ...Array(Math.max(0, size - rawLeaves.length)).fill(0n)];
  let cur = leaves;
  for (let d = 0; d < depth; d++) {
    const next: bigint[] = [];
    for (let i = 0; i < cur.length; i += 2) next.push(h2(cur[i]!, cur[i + 1]!));
    cur = next;
  }
  return cur[0]!;
}

export interface MembershipProof {
  proof: unknown;
  publicSignals: string[];
}

/** Verify a Groth16 membership proof against an EXPECTED public root + signalHash. */
export async function verifyMembership(p: MembershipProof, expected: { root: bigint; signalHash: bigint }): Promise<boolean> {
  if (p.publicSignals?.[0] !== expected.root.toString()) return false;
  if (p.publicSignals?.[1] !== expected.signalHash.toString()) return false;
  return (await getGroth16()).verify(VKEY, p.publicSignals, p.proof);
}
