#!/usr/bin/env bash
# Compile the circuit + run a LOCAL Groth16 trusted setup (powersOfTau phase-1
# universal + circuit-specific phase-2). Demo-only ceremony; a production setup
# would use a multi-party ceremony. Produces build/{merkle.wasm, merkle.zkey,
# verification_key.json} — the prover (wasm + zkey) and the verifier (vkey).
set -euo pipefail
cd "$(dirname "$0")/.."

export PATH="$HOME/.local/bin:$PATH"
BUILD=build
CIRCOMLIB=node_modules/circomlib/circuits
SNARKJS="node node_modules/snarkjs/build/cli.cjs"
mkdir -p "$BUILD"

echo "→ compile circuit"
circom circuits/merkle.circom --r1cs --wasm --sym -l "$CIRCOMLIB" -o "$BUILD"

echo "→ powersOfTau (phase 1, bn128, 2^12)"
$SNARKJS powersoftau new bn128 12 "$BUILD/pot12_0.ptau" -v
$SNARKJS powersoftau contribute "$BUILD/pot12_0.ptau" "$BUILD/pot12_1.ptau" --name="demo" -v -e="demo entropy"
$SNARKJS powersoftau prepare phase2 "$BUILD/pot12_1.ptau" "$BUILD/pot12_final.ptau" -v

echo "→ groth16 setup (phase 2)"
$SNARKJS groth16 setup "$BUILD/merkle.r1cs" "$BUILD/pot12_final.ptau" "$BUILD/merkle_0.zkey"
$SNARKJS zkey contribute "$BUILD/merkle_0.zkey" "$BUILD/merkle.zkey" --name="demo" -v -e="demo entropy 2"
$SNARKJS zkey export verificationkey "$BUILD/merkle.zkey" "$BUILD/verification_key.json"

# keep only what the prover/verifier need
cp "$BUILD/merkle_js/merkle.wasm" "$BUILD/merkle.wasm"
rm -f "$BUILD"/pot12_*.ptau "$BUILD/merkle_0.zkey"
echo "✓ zk setup complete → build/{merkle.wasm, merkle.zkey, verification_key.json}"
