pragma circom 2.1.6;

include "poseidon.circom";
include "mux1.circom";

// Recompute a Merkle root from a leaf + authentication path using Poseidon(2).
// pathIndices[i] == 0 → current node is the LEFT input at level i, else RIGHT.
template MerkleRoot(depth) {
    signal input leaf;
    signal input pathElements[depth];
    signal input pathIndices[depth];
    signal output root;

    component hashers[depth];
    component mux[depth];
    signal cur[depth + 1];
    cur[0] <== leaf;

    for (var i = 0; i < depth; i++) {
        pathIndices[i] * (1 - pathIndices[i]) === 0; // boolean

        mux[i] = MultiMux1(2);
        mux[i].c[0][0] <== cur[i];
        mux[i].c[0][1] <== pathElements[i];
        mux[i].c[1][0] <== pathElements[i];
        mux[i].c[1][1] <== cur[i];
        mux[i].s <== pathIndices[i];

        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== mux[i].out[0];
        hashers[i].inputs[1] <== mux[i].out[1];
        cur[i + 1] <== hashers[i].out;
    }

    root <== cur[depth];
}

// Prove knowledge of a (leaf, path) whose Merkle root equals the PUBLIC root,
// WITHOUT revealing the leaf or its position — zk membership of a content
// commitment in an issuer corpus. `signalHash` is a public input bound into the
// proof (squared) so a valid proof cannot be lifted onto a different response.
template Membership(depth) {
    signal input root;       // public — the issuer's Poseidon corpus root
    signal input signalHash; // public — binds the proof to a specific response
    signal input leaf;       // private — the content commitment (field element)
    signal input pathElements[depth]; // private
    signal input pathIndices[depth];  // private

    component mr = MerkleRoot(depth);
    mr.leaf <== leaf;
    for (var i = 0; i < depth; i++) {
        mr.pathElements[i] <== pathElements[i];
        mr.pathIndices[i] <== pathIndices[i];
    }
    root === mr.root;

    signal sqr;
    sqr <== signalHash * signalHash; // anchor signalHash into the constraint system
}

component main {public [root, signalHash]} = Membership(4);
