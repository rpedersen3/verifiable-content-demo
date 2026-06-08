// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title ContentCorpusRegistry — on-chain anchor for verifiable-content corpora
///        (spec 266 Phase 3). Stores a corpus's Merkle `corpusRoot` + signed
///        `manifestHash` per `corpusRef`, gated to the issuer Smart Agent via
///        ERC-1271. Verifiers read the corpusRoot from chain (trustless) instead
///        of trusting the issuer's off-chain manifest.
///
///        Demo-local stand-in for what would be an agenticprimitives substrate
///        primitive (packages/contracts/src/content/). No external imports.
interface IERC1271 {
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4);
}

contract ContentCorpusRegistry {
    bytes4 private constant ERC1271_MAGIC = 0x1626ba7e;

    struct Corpus {
        address issuer;       // the issuer Smart Agent that anchored this corpus
        bytes32 corpusRoot;   // Merkle root over the per-locus descriptor commitments
        bytes32 manifestHash; // hash of the off-chain corpus manifest
        uint64 anchoredAt;    // block timestamp of the latest anchor
    }

    mapping(bytes32 corpusRef => Corpus) private _corpora;

    event CorpusAnchored(
        bytes32 indexed corpusRef,
        address indexed issuer,
        bytes32 corpusRoot,
        bytes32 manifestHash
    );

    /// @notice The digest the issuer SA must ERC-1271-sign to authorize an anchor.
    function anchorDigest(
        bytes32 corpusRef,
        bytes32 corpusRoot,
        bytes32 manifestHash,
        address issuer
    ) public view returns (bytes32) {
        return keccak256(
            abi.encode("ap:content-corpus-anchor:v1", block.chainid, address(this), corpusRef, corpusRoot, manifestHash, issuer)
        );
    }

    /// @notice Anchor (or update) a corpus. Anyone may submit, but the `issuer`
    ///         SA must have ERC-1271-signed the digest. First anchor binds the
    ///         issuer; updates require the same issuer.
    function anchor(
        bytes32 corpusRef,
        bytes32 corpusRoot,
        bytes32 manifestHash,
        address issuer,
        bytes calldata signature
    ) external {
        Corpus storage existing = _corpora[corpusRef];
        require(existing.issuer == address(0) || existing.issuer == issuer, "issuer mismatch");

        bytes32 digest = anchorDigest(corpusRef, corpusRoot, manifestHash, issuer);
        require(IERC1271(issuer).isValidSignature(digest, signature) == ERC1271_MAGIC, "bad issuer signature");

        _corpora[corpusRef] = Corpus(issuer, corpusRoot, manifestHash, uint64(block.timestamp));
        emit CorpusAnchored(corpusRef, issuer, corpusRoot, manifestHash);
    }

    function getCorpus(bytes32 corpusRef)
        external
        view
        returns (address issuer, bytes32 corpusRoot, bytes32 manifestHash, uint64 anchoredAt)
    {
        Corpus memory c = _corpora[corpusRef];
        return (c.issuer, c.corpusRoot, c.manifestHash, c.anchoredAt);
    }
}
