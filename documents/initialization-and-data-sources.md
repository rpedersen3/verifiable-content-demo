# Initialization and Data Sources

## Purpose

This document shows how scripture verse data, edition configuration, corpus registries, contract registries, and validator data sources are initialized across the demo.

The short version:

1. Verse text starts as off-platform app data.
2. Edition config turns text into named corpora.
3. Corpus initialization builds commitments, descriptors, Merkle roots, and manifests.
4. Trust context decides whether those descriptors are signed by the dev EOA or an on-chain Smart Agent.
5. On-chain bootstrap registers issuer naming data and anchors corpus roots.
6. MCP exposes edition, corpus, resolve, text, entitlement, and verification APIs.
7. A2A and validator consume those APIs to produce citations, evidence bundles, attestations, trust graphs, and optional anchors.

## Configured Data Sources

| Source | Location | Used By | Purpose |
| --- | --- | --- | --- |
| BSB verse text | `apps/demo-bible-mcp/src/data/bsb.ts` | MCP corpus builder | Public-domain scripture text, keyed by OSIS path. |
| Synthetic licensed text | `apps/demo-bible-mcp/src/editions/registry.ts` | MCP corpus builder | Mock licensed edition used to exercise entitlement gates. |
| Edition registry | `apps/demo-bible-mcp/src/editions/registry.ts` | MCP `/mcp/editions`, resolver, corpus builder | Configures editions, issuers, rights status, access policy, and text maps. |
| Scripture canon and parser | `@agenticprimitives/scripture-content-extension` | MCP resolver and corpus builder | Parses OSIS/common references into canonical scripture loci. |
| Content primitives | `@agenticprimitives/content-primitives` | MCP, A2A, validator | Builds commitments, descriptors, corpus trees, citations, and verification checks. |
| MCP runtime env | `apps/demo-bible-mcp/.dev.vars` or Cloudflare vars | MCP trust context | Selects dev vs on-chain trust and registry addresses. |
| Agentic Primitives deployments | `AP_DEPLOYMENTS` / deployed contract JSON | bootstrap script | Supplies Agent Account, Agent Naming, and `ContentCorpusRegistry` addresses. |
| Validator env | Vercel/local env | validator | Supplies trusted issuers, MCP URL, RPC URL, validator SA/signing, and optional attestation registry. |
| ZK setup artifacts | `packages/zk-membership/build/` and validator `vkey.ts` | e2e prover, hosted validator | Proves and verifies Groth16 membership. |

## Verse Data Initialization

The only real scripture text shipped in the demo is the public-domain BSB sample in `apps/demo-bible-mcp/src/data/bsb.ts`.

```mermaid
flowchart TD
  BsbFile["bsb.ts\nBSB_VERSES"]
  OsisKeys["OSIS keys\nJohn.3.16, Rom.8.28"]
  EditionEntry["EditionEntry\nbsb"]
  LicensedMock["Synthetic licensed texts"]
  Editions["EDITIONS array"]

  BsbFile --> OsisKeys --> EditionEntry --> Editions
  BsbFile --> LicensedMock --> Editions
```

Important details:

- `BSB_EDITION = "bsb"`.
- `BSB_VERSION = "2023"`.
- Text is keyed by OSIS path, for example `John.3.16`.
- `demo-licensed` is generated from the same OSIS keys, but its text is synthetic placeholder text.
- The demo does not embed copyrighted licensed Bible text.

## Edition Registry Initialization

`EDITIONS` is the local source of truth for configured demo editions.

| Field | Meaning |
| --- | --- |
| `edition` | Stable edition id, such as `bsb` or `demo-licensed`. |
| `version` | Edition version. |
| `displayName` | User-facing translation name. |
| `issuerName` | Agent Naming style issuer name. |
| `language` | Language metadata. |
| `accessPolicy` | `public`, `licensed`, or `private`. |
| `rightsStatus` | `public-domain`, `licensed`, etc. |
| `texts` | OSIS-path to verse rendering map. |

```mermaid
flowchart LR
  Editions["EDITIONS"]
  Bsb["bsb\npublic\npublic-domain"]
  Licensed["demo-licensed\nlicensed\nsynthetic"]
  RegistryApi["GET /mcp/editions"]
  Picker["Web translation picker"]
  Resolver["MCP candidate resolver"]

  Editions --> Bsb
  Editions --> Licensed
  Editions --> RegistryApi --> Picker
  Editions --> Resolver
```

## Corpus Build

MCP lazily builds corpora through `getCorpora(trust)`. Corpora are cached per issuer address so dev and on-chain modes do not collide.

```mermaid
sequenceDiagram
  participant MCP
  participant Trust as TrustContext
  participant Registry as Edition Registry
  participant Scripture as Scripture Extension
  participant Content as Content Primitives

  MCP->>Trust: resolveTrust(env)
  Trust-->>MCP: issuer + signDigest + verifySignature
  MCP->>Registry: getCorpora(trust)
  loop each EditionEntry
    Registry->>Scripture: parseScriptureAlias(OSIS path)
    Scripture-->>Registry: CanonicalLocusId + selector
    Registry->>Content: contentCommitment(text)
    Registry->>Content: buildCorpusTree(leafHash(commitment))
    Registry->>Content: corpusRef(issuer, edition, version)
    Registry->>Content: buildContentDescriptor(...)
    Content-->>Registry: signed ContentDescriptor
  end
  Registry-->>MCP: Map edition -> BuiltCorpus
```

Each built corpus contains:

- `entry`: the `EditionEntry`.
- `manifest`: `CorpusManifest` with `corpusRef`, `issuer`, `edition`, `version`, `scheme`, `corpusRoot`, `accessPolicy`, `proofPolicy`, and `licenseTermsHash`.
- `tree`: Merkle tree over descriptor commitment leaves.
- `byCanonicalId`: map from canonical scripture id to descriptor row.

## Descriptor and Commitment Construction

For each verse:

```mermaid
flowchart TD
  Text["Verse text"]
  Commitment["contentCommitment(text)"]
  Leaf["leafHash(commitment.value)"]
  Tree["buildCorpusTree"]
  Root["corpusRoot"]
  Canonical["parseScriptureAlias(OSIS)\nCanonicalLocusId"]
  Descriptor["ContentDescriptor"]
  Signature["Issuer signature"]

  Text --> Commitment --> Leaf --> Tree --> Root
  Canonical --> Descriptor
  Commitment --> Descriptor
  Root --> Descriptor
  Descriptor --> Signature
```

Each descriptor includes:

- `id`: `desc_<edition>_<canonicalId prefix>`.
- `canonicalId`: deterministic scripture locus id.
- `contentType`: `scripture.verse`.
- `issuer`: dev EOA or on-chain Smart Agent address.
- `selector`: parsed scripture selector.
- `commitment`: commitment to the actual text.
- `retrievalPointer`: `content://scripture.verse/<edition>/<osis>`.
- `proofPolicy`: `merkle-membership-v1`.
- `accessPolicy`: edition policy.
- `corpusRef`: issuer/edition/version corpus reference.

The descriptor points to text but does not contain text.

## Trust Context Initialization

MCP chooses one of two signing and verification strategies.

```mermaid
flowchart TD
  Env["Worker env"]
  Mode{"TRUST_MODE"}
  Dev["dev mode\nfixed EOA"]
  Onchain["onchain mode\nSmart Agent"]
  Naming["Agent Naming\nresolve ISSUER_NAME"]
  Account["Agent Account\nERC-1271"]
  CorpusRegistry["ContentCorpusRegistry\nread corpus root"]
  Trust["TrustContext"]

  Env --> Mode
  Mode -->|unset or dev| Dev --> Trust
  Mode -->|onchain| Onchain
  Onchain --> Naming --> Account --> CorpusRegistry --> Trust
```

### Dev Mode

Default behavior:

- Uses fixed dev issuer key from `registry.ts`.
- Signs descriptors and entitlements with EOA recovery.
- Uses off-chain manifest `corpusRoot`.
- Good for local development and smoke tests.

### On-Chain Mode

Configured through environment variables:

| Env | Purpose |
| --- | --- |
| `TRUST_MODE=onchain` | Enables on-chain issuer trust. |
| `RPC_URL` | Chain RPC. |
| `CHAIN_ID` | Chain id. |
| `FACTORY` | Agent Account factory. |
| `ENTRY_POINT` | ERC-4337 entry point. |
| `REGISTRY` | Agent Naming registry. |
| `UNIVERSAL_RESOLVER` | Agent Naming universal resolver. |
| `CONTENT_REGISTRY` | `ContentCorpusRegistry` address. |
| `ISSUER_NAME` | Agent name, such as `bsb.agent`. |
| `ISSUER_SA` | Expected issuer Smart Agent address. |
| `ISSUER_OWNER_PK` | Owner key used to sign in the demo. |

On-chain mode:

- Resolves `ISSUER_NAME` through Agent Naming.
- Confirms it matches `ISSUER_SA`.
- Signs descriptor digests through the owner key in ERC-1271-compatible format.
- Verifies signatures through `AgentAccountClient.isValidSignature`.
- Reads anchored corpus roots from `ContentCorpusRegistry` when available.

## On-Chain Bootstrap

`apps/demo-bible-mcp/scripts/bootstrap-onchain.ts` initializes the on-chain trust environment.

```mermaid
sequenceDiagram
  participant Script as bootstrap-onchain.ts
  participant Deployments as AP deployments
  participant Account as Agent Account
  participant Naming as Agent Naming
  participant CorpusReg as ContentCorpusRegistry
  participant Files as .dev.vars/onchain.json

  Script->>Deployments: Read contract addresses
  Script->>Account: Create issuer Smart Agent
  Script->>Account: Prove ERC-1271 isValidSignature
  Script->>Naming: Register bsb.agent
  Script->>Naming: Set address/display/kind records
  Script->>Naming: Resolve bsb.agent
  Script->>Account: Build and verify sample descriptor
  loop each edition
    Script->>CorpusReg: anchor(corpusRef, corpusRoot, manifestHash, issuer, signature)
    CorpusReg-->>Script: anchored corpus root
  end
  Script->>Files: Write onchain.json + .dev.vars
```

The bootstrap writes MCP configuration so the worker can start in on-chain mode.

## Runtime APIs and Their Data Sources

| Endpoint | Data Sources | Returns |
| --- | --- | --- |
| `GET /health` | `TrustContext` | Mode, issuer, issuer name, anchoring flag. |
| `GET /mcp/editions` | `EDITIONS`, built corpora, trust issuer | Edition registry with `corpusRef`, `corpusRoot`, issuer, policy. |
| `GET /mcp/books` | Scripture extension `BOOKS` | Book table for picker. |
| `GET /corpus/:edition` | Built corpus descriptors | Ordered public commitments for validator ZK root derivation. |
| `POST /tools/resolve` | Scripture parser, built corpora, trust profile, optional on-chain root | Canonical locus, display reference, candidates, descriptors, proofs. |
| `POST /tools/get_passage_text` | Built corpus, source text map, entitlement verifier | Text or access denial. |
| `POST /tools/issue_entitlement` | Built corpus, trust credential signer | Signed entitlement VC. |
| `POST /tools/verify_citation` | Built corpus descriptor | Commitment match result. |

## Validator Data Sources

The validator uses three data sources:

```mermaid
flowchart LR
  Bundle["EvidenceBundle\nfrom A2A or e2e"]
  MCP["MCP /corpus/:edition"]
  Env["Validator env"]
  ZK["Verifier key + snarkjs"]
  Validator["demo-validator"]
  Attestation["ValidationAttestation"]
  Graph["TrustGraphSnapshot"]
  Anchor["Optional chain anchor"]

  Bundle --> Validator
  MCP --> Validator
  Env --> Validator
  ZK --> Validator
  Validator --> Attestation
  Validator --> Graph
  Validator --> Anchor
```

| Source | Purpose |
| --- | --- |
| Evidence bundle | Claims to verify: canonical id, descriptor, proof, policy, citation, response. |
| `MCP_URL /corpus/:edition` | Ordered commitments for Poseidon root derivation. |
| `VALIDATOR_TRUSTED_ISSUERS` | Validator trust profile. |
| `VALIDATOR_RPC_URL` | Enables ERC-1271 checks and anchoring. |
| `VALIDATOR_SA` / `VALIDATOR_OWNER_PK` | Validator signing identity. |
| `ATTESTATION_REGISTRY` | Optional registry for attestation hash anchors. |
| ZK verification key | Verifies Groth16 membership proof public signals. |

## A2A Data Sources

A2A does not own scripture data. It orchestrates:

| A2A Feature | Data Source |
| --- | --- |
| `/editions` | MCP `/mcp/editions`. |
| `/books` | MCP `/mcp/books`. |
| `/resolve` | MCP `/tools/resolve` and `/tools/get_passage_text`. |
| `/issue-entitlement` | MCP `/tools/issue_entitlement`. |
| `/ask` | Local topic map plus MCP resolve/text calls. |
| `/verify` | Signed citation plus MCP `/tools/verify_citation`. |
| `/transparency` | In-memory citation log. |
| `/trust/validate` | MCP resolve/text output plus `VALIDATOR_URL /validate`. |

## Web Data Sources

The web app reads through the A2A base path:

| UI Area | API |
| --- | --- |
| Translation picker | `GET /a2a/editions`. |
| Book picker | `GET /a2a/books`. |
| Verse lookup | `POST /a2a/resolve`. |
| Licensed gate retry | `POST /a2a/issue-entitlement`, then `POST /a2a/resolve`. |
| Ask panel | `POST /a2a/ask`. |
| Citation verification | `POST /a2a/verify`. |
| Trust graph card | `POST /a2a/trust/validate`. |

## End-to-End Initialization Order

```mermaid
flowchart TD
  Install["pnpm install"]
  ZkSetup["pnpm zk:setup"]
  Contracts["Deploy Agentic Primitives contracts"]
  Bootstrap["bootstrap-onchain.ts"]
  McpEnv["MCP env configured"]
  McpStart["Start MCP"]
  A2aStart["Start A2A"]
  ValidatorStart["Start validator"]
  WebStart["Start web"]
  Validate["pnpm validate:e2e"]

  Install --> ZkSetup
  Install --> Contracts --> Bootstrap --> McpEnv
  McpEnv --> McpStart
  McpStart --> A2aStart
  McpStart --> ValidatorStart
  A2aStart --> WebStart
  ValidatorStart --> Validate
  A2aStart --> Validate
```

Local dev can skip the contract/bootstrap path and use dev EOA mode. Hosted/on-chain mode requires deployed Agentic Primitives contracts and environment variables.

## What Is Initialized Lazily

| Item | When Built |
| --- | --- |
| `TrustContext` | First MCP request, cached in `resolveTrust`. |
| Corpora | First call to `getCorpora(trust)`, cached per issuer address. |
| Descriptors | During corpus build. |
| Merkle trees | During corpus build. |
| Validator Poseidon root | During validation when `zkMembership` is present. |
| Validation attestation | During validator `/validate` after schema check. |
| Attestation anchor | During validator `/validate` when env is configured; best-effort. |

## Current Demo Data Boundaries

- Real public-domain BSB sample text is embedded in the MCP app.
- Mock licensed text is synthetic and exists only to exercise entitlement behavior.
- Verse text is never placed on-chain.
- MCP exposes public commitments through `/corpus/:edition`, not verse text.
- On-chain roots anchor corpus integrity, not content rights by themselves.
- Validator attestation anchors are compact hashes; full bundles and checks remain off-chain.
