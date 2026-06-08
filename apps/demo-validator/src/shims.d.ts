declare module 'snarkjs' {
  export const groth16: {
    verify(vkey: unknown, publicSignals: string[], proof: unknown): Promise<boolean>;
  };
}
declare module 'circomlibjs' {
  export interface PoseidonF {
    toObject(x: unknown): bigint;
  }
  export interface Poseidon {
    (inputs: bigint[]): unknown;
    F: PoseidonF;
  }
  export function buildPoseidon(): Promise<Poseidon>;
}
