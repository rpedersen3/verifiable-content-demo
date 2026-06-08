# Technical Architecture

## Purpose

This document maps the architecture to code: workspace packages, endpoints, domain types, verification logic, and extension points.

## Workspace Layout

```text
apps/
  demo-bible-web/   React + Vite UI
  demo-bible-a2a/   Hono Worker orchestration agent
  demo-bible-mcp/   Hono Worker content/tool server
  demo-validator/   Hono Node service for independent validation
packages/
  zk-membership/    Groth16 zk-SNARK membership proof package
  legal-content-extension/  second vertical proving genericity
scripts/
  check-no-licensed-content.ts
documents/
  architecture documentation
```

## Package Dependencies

```mermaid
flowchart TD
  Web["demo-bible-web"]
  A2A["demo-bible-a2a"]
  MCP["demo-bible-mcp"]
  Validator["demo-validator"]
  ZK["zk-membership"]
  CP["@agenticprimitives/content-primitives"]
  Scripture["@agenticprimitives/scripture-content-extension"]
  Policy["@agenticprimitives/tool-policy"]
  Audit["@agenticprimitives/audit"]
  VC["@agenticprimitives/verifiable-credentials"]
  Naming["@agenticprimitives/agent-naming"]
  Account["@agenticprimitives/agent-account"]
  Snark["circomlibjs / snarkjs"]
  Types["@agenticprimitives/types"]

  Web --> React["react / react-dom"]
  A2A --> CP
  A2A --> Types
  MCP --> CP
  MCP --> Scripture
  MCP --> Policy
  MCP --> Audit
  MCP --> VC
  MCP --> Naming
  MCP --> Account
  MCP --> Types
  Validator --> CP
  Validator --> VC
  Validator --> ZK
  ZK --> Snark
```

## API Surface

### Web to A2A

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/a2a/editions` | Load edition registry for the picker. |
| `GET` | `/a2a/books` | Load OSIS book table for the picker. |
| `POST` | `/a2a/resolve` | Resolve a passage and return text/provenance/citation. |
| `POST` | `/a2a/issue-entitlement` | Request a signed entitlement for a gated edition. |

### A2A

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Service health. |
| `GET` | `/.well-known/agent-card.json` | A2A discovery metadata and skill declaration. |
| `GET` | `/editions` | Proxy to MCP edition registry. |
| `GET` | `/books` | Proxy to MCP book table. |
| `POST` | `/issue-entitlement` | Proxy signed entitlement issuance to MCP. |
| `POST` | `/resolve` | Orchestrated scripture resolution skill. |

### MCP

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Service health and issuer. |
| `GET` | `/mcp/editions` | Public edition registry. |
| `GET` | `/mcp/books` | OSIS book table. |
| `GET` | `/corpus/:edition` | Ordered public commitments for validator ZK root derivation. |
| `POST` | `/tools/resolve` | Resolve canonical locus and candidate descriptors. |
| `POST` | `/tools/get_passage_text` | Return text when access policy allows it. |
| `POST` | `/tools/issue_entitlement` | Issue signed entitlement for non-public editions. |
| `POST` | `/tools/verify_citation` | Re-check commitment against descriptor. |

### Validator

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Service health, configured MCP URL, and trusted issuer list. |
| `POST` | `/validate` | Validate an evidence bundle and return `validated`, `gated`, or `rejected`. |

## Resolve Implementation

```mermaid
flowchart TD
  Body["reference"]
  Parse["parseScriptureAlias"]
  Corpora["getCorpora"]
  Descriptors["Collect descriptors for canonical id"]
  Resolve["resolveCandidates"]
  Verify["verifyContentDescriptor"]
  Response["canonicalReference + display + candidates"]

  Evidence["Evidence fields\ncorpusRef, corpusRoot, proof, leafIndex, descriptor"]

  Body --> Parse --> Corpora --> Descriptors --> Resolve --> Verify --> Evidence --> Response
```

Key code:

- `apps/demo-bible-mcp/src/index.ts` owns the MCP routes.
- `apps/demo-bible-mcp/src/editions/registry.ts` builds corpora, manifests, descriptors, Merkle trees, and inclusion proofs.
- `apps/demo-bible-a2a/src/index.ts` owns orchestration and citation creation.
- `apps/demo-bible-web/src/api.ts` owns browser-side API calls and response shapes.
- `apps/demo-bible-web/src/App.tsx` owns the picker, result card, provenance card, candidate list, and citation details.
- `apps/demo-validator/src/bundle.ts` defines the compact validation envelope.
- `apps/demo-validator/src/validate.ts` re-derives and checks the validation bundle.
- `apps/demo-validator/src/assemble.ts` assembles a bundle from an A2A response and optional ZK proof.
- `packages/zk-membership/src/index.ts` builds Poseidon trees, creates Groth16 proofs, and verifies them.

## Core Domain Types

```mermaid
classDiagram
  class Edition {
    edition
    version
    displayName
    issuerName
    issuer
    accessPolicy
    rightsStatus
    corpusRef
    corpusRoot
  }

  class Candidate {
    descriptorId
    edition
    issuerName
    accessPolicy
    admitted
    issuerTrusted
    verification
    commitment
  }

  class ResolveResult {
    ok
    canonicalReference
    display
    candidates
    chosen
    accessible
    text
    commitmentVerified
    citation
    gate
  }

  class Entitlement {
    issuer
    validFrom
    validUntil
    credentialSubject
    proof
  }

  class EvidenceBundle {
    intent
    agent
    content
    proof
    policy
    citation
    response
  }

  class ZkMembership {
    proof
    publicSignals
  }

  class ValidationResult {
    outcome
    checks
  }

  Edition --> Candidate
  Candidate --> ResolveResult
  Entitlement --> ResolveResult
  ResolveResult --> EvidenceBundle
  ZkMembership --> EvidenceBundle
  EvidenceBundle --> ValidationResult
```

## Corpus Build

At boot, `getCorpora()` lazily builds and caches corpora from `EDITIONS`.

```mermaid
sequenceDiagram
  participant MCP
  participant Registry
  participant SDK as Content Primitives

  MCP->>Registry: getCorpora()
  Registry->>Registry: Read EDITIONS
  loop each edition
    Registry->>SDK: corpusRef(issuer, edition, version)
    Registry->>SDK: contentCommitment(text)
    Registry->>SDK: buildCorpusTree(leaves)
    Registry->>SDK: buildContentDescriptor(...)
    SDK-->>Registry: Signed descriptor
  end
  Registry-->>MCP: Map edition -> BuiltCorpus
```

## Verification Algorithm

Descriptor verification:

1. Parse reference into canonical scripture locus.
2. Collect descriptors for the locus across editions.
3. Apply trust profile with `resolveCandidates`.
4. For admitted candidates, verify issuer signature.
5. Verify Merkle inclusion against the corpus root.
6. In on-chain mode, optionally read the expected corpus root from `ContentCorpusRegistry`.

Text verification:

1. Retrieve text only after access policy allows it.
2. Recompute normalized commitment.
3. Compare against the descriptor commitment.
4. Include `commitmentVerified` in the A2A response and citation.

Validator verification:

1. Check the bundle shape.
2. Recompute `canonicalId` from `canonicalEnvelope`.
3. Verify descriptor signature and keccak Merkle inclusion.
4. Check issuer admission against `trustedIssuers`.
5. Verify commitment-to-text and response hash binding.
6. Verify policy and issuer-signed entitlement when required.
7. Verify the responding agent's signed `CitationAssertion`.
8. Verify citation binding to `{canonicalId, descriptorId, commitment, agentRunId, outputId}`.
9. If present, verify Groth16 zk membership against a Poseidon root derived from `GET /corpus/:edition`.

```mermaid
flowchart LR
  Text["Verse text"]
  Normalize["Commitment normalization"]
  Hash["Commitment hash"]
  Descriptor["Descriptor commitment"]
  Result{"matches?"}

  Text --> Normalize --> Hash --> Result
  Descriptor --> Result
```

## ZK Membership

The `zk-membership` package proves that the cited commitment is a member of the issuer's corpus without revealing the leaf or its index. It uses a fixed-depth Poseidon Merkle tree and Groth16 proof generated by `snarkjs`.

```mermaid
flowchart LR
  Commitments["Issuer public commitments"]
  Poseidon["Poseidon Merkle tree"]
  Root["Public root"]
  Private["Private leaf + path"]
  Response["responseHash"]
  Signal["signalHash"]
  Proof["Groth16 proof"]
  Validator["Validator verifies\nroot + signalHash"]

  Commitments --> Poseidon --> Root
  Private --> Proof
  Response --> Signal --> Proof
  Root --> Proof
  Proof --> Validator
```

Public signals are `[root, signalHash]`. The leaf, index, and path stay private. Run `pnpm zk:setup` before generating or verifying proofs.

## Evidence Bundle

The validator expects the compact envelope from `apps/demo-validator/src/bundle.ts`:

| Section | Purpose |
| --- | --- |
| `intent` | What the user/agent intended: reference, edition, run id, output id. |
| `agent` | Responding agent identity and optional name. |
| `content` | Canonical id/envelope, descriptor, issuer, edition, access policy. |
| `proof` | Commitment, corpus root, inclusion proof, leaf index, optional zk membership. |
| `policy` | Trust profile, policy decision, optional entitlement. |
| `citation` | Signed `CitationAssertion`. |
| `response` | Text, response hash, and quoted span bindings. |

## Adding a Translation

For a public-domain edition:

1. Add OSIS-keyed text in `apps/demo-bible-mcp/src/data/<edition>.ts`.
2. Add an `EditionEntry` in `apps/demo-bible-mcp/src/editions/registry.ts`.
3. Run `pnpm check:no-licensed-content`.
4. Run `pnpm typecheck`, `pnpm smoke`, and `pnpm validate:e2e`.

No web or A2A code change is needed because editions flow from the MCP registry to the picker.

```mermaid
flowchart TD
  Text["Add OSIS text file"]
  Registry["Add EditionEntry"]
  Build["Corpus built on boot"]
  MCP["/mcp/editions returns new edition"]
  A2A["/editions proxies it"]
  Web["Picker displays it"]

  Text --> Registry --> Build --> MCP --> A2A --> Web
```

## Current Implementation Notes

- `demo-licensed` uses synthetic placeholder text, not copyrighted scripture.
- The dev issuer is a fixed EOA; on-chain mode resolves an issuer Smart Agent by Agent Naming and verifies via ERC-1271.
- `issue_entitlement` creates signed credentials and the web path requests them through A2A `/issue-entitlement`.
- `validate:e2e` demonstrates an honest bundle, a tampered response, and an untrusted issuer profile.
- CORS is enabled on the demo services.
- The root package pins `@agenticprimitives/*` packages at alpha ranges.
