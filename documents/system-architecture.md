# System Architecture

## Purpose

The system demonstrates verifiable scripture lookup using a UI, an A2A orchestration agent, an MCP content/tool server, an independent validator, a ZK membership verifier, and on-chain trust anchors. Trust is attached to descriptors, commitments, issuer signatures, corpus roots, optional zk membership proofs, policy decisions, signed citations, signed validation attestations, trust graph edges, and validator outcomes rather than to the UI.

## Component View

```mermaid
flowchart TB
  subgraph Client["Client Boundary"]
    Web["demo-bible-web\nReact UI"]
  end

  subgraph Agent["Agent Boundary"]
    A2A["demo-bible-a2a\nresolve-scripture-passage skill"]
  end

  subgraph Content["Content + Trust Boundary"]
    MCP["demo-bible-mcp\nMCP-style tools"]
    Registry["Edition registry"]
    Corpus["Built corpora\nContentDescriptors + Merkle roots"]
    TextStore["Off-platform text store"]
    Audit["Audit sink"]
    Policy["Tool + entitlement policy"]
  end

  subgraph Validation["Independent Validation Boundary"]
    Validator["demo-validator\nthird-party validator"]
    ZK["zk-membership\nGroth16 membership proof"]
    Attestation["ValidationAttestation\nsigned validator result"]
    TrustGraph["TrustGraphSnapshot\nscoped trust edges"]
  end

  subgraph Contracts["On-Chain Trust Anchors"]
    Naming["Agent Naming\nregistry + resolver"]
    Account["Agent Account\nSmart Agent ERC-1271"]
    CorpusRegistry["ContentCorpusRegistry\nissuer corpus roots"]
    AttestationRegistry["ValidationAttestationRegistry\nattestation hashes"]
  end

  Web --> A2A
  A2A --> MCP
  MCP --> Registry
  MCP --> Corpus
  MCP --> TextStore
  MCP --> Policy
  MCP --> Audit
  A2A --> Validator
  Validator --> MCP
  Validator --> ZK
  Validator --> Attestation
  Validator --> TrustGraph
  MCP --> Naming
  MCP --> Account
  MCP --> CorpusRegistry
  Validator --> Account
  Validator --> AttestationRegistry
```

## Responsibilities

| Component | Responsibility | Does Not Own |
| --- | --- | --- |
| Web | User interaction, result rendering, provenance display. | Descriptor verification or corpus building. |
| A2A | Orchestrates resolve, text retrieval, verification, and citation building. | Raw corpus data or trust policy configuration. |
| MCP | Owns tools, corpora, policy gates, entitlement checks, descriptor verification, and audit. | UI decisions. |
| Validator | Re-checks evidence bundles independently and returns `validated`, `gated`, or `rejected`. | Content serving or user-facing retrieval. |
| ZK membership package | Proves a commitment belongs to an issuer corpus without revealing the leaf/index. | Publisher rights, content retrieval, or policy. |
| Agent Account / ERC-1271 | Verifies Smart Agent signatures for issuers and validator agents. | Content semantics or policy decisions. |
| Agent Naming | Resolves human-readable agent names such as `bsb.agent`. | Passage canonicalization. |
| ContentCorpusRegistry | Anchors issuer corpus roots on-chain. | Verse text or descriptors. |
| ValidationAttestationRegistry | Optionally anchors signed validation attestation hashes. | Full evidence-bundle storage. |
| Agentic Primitives packages | Canonicalization, descriptor building, commitments, verification, policy, audit primitives. | Demo-specific corpus content. |

## Main Lookup Flow

```mermaid
sequenceDiagram
  participant User
  participant Web
  participant A2A
  participant MCP
  participant Corpus
  participant Audit

  User->>Web: Select passage + edition
  Web->>A2A: POST /resolve
  A2A->>MCP: POST /tools/resolve(reference)
  MCP->>MCP: Parse alias to canonical locus
  MCP->>Corpus: Find descriptors across editions
  MCP->>MCP: Resolve candidates under trust profile
  MCP->>MCP: Verify admitted descriptors
  MCP->>Audit: content.resolve
  MCP-->>A2A: Canonical reference + candidates
  A2A->>A2A: Pick requested edition or best verified candidate
  A2A->>MCP: POST /tools/get_passage_text
  MCP->>MCP: Evaluate entitlement/access policy
  MCP->>Corpus: Read off-platform text if allowed
  MCP->>Audit: content.text.access
  MCP-->>A2A: Text or access denial
  A2A->>A2A: Verify text commitment when text is returned
  A2A->>A2A: Build and sign CitationAssertion
  A2A-->>Web: Result, provenance, citation
  Web-->>User: Verse or gate + evidence
```

## Full Demo Interaction

```mermaid
sequenceDiagram
  participant User
  participant Web
  participant A2A as A2A Agent
  participant MCP
  participant Naming as Agent Naming
  participant Account as Agent Account ERC1271
  participant CorpusReg as ContentCorpusRegistry
  participant Validator
  participant ZK as Groth16 Verifier
  participant AttestReg as ValidationAttestationRegistry

  User->>Web: Lookup or validate passage
  Web->>A2A: POST /resolve or /trust/validate
  A2A->>MCP: POST /tools/resolve
  MCP->>Naming: Resolve issuerName when on-chain
  MCP->>Account: Verify issuer descriptor signature
  MCP->>CorpusReg: Read anchored corpusRoot
  MCP-->>A2A: CanonicalLocusId + ContentDescriptor candidates + proofs
  A2A->>MCP: POST /tools/get_passage_text
  MCP-->>A2A: Text or gated denial
  A2A->>A2A: Verify commitment and sign CitationAssertion
  A2A->>Validator: POST /validate EvidenceBundle
  Validator->>MCP: GET /corpus/:edition
  MCP-->>Validator: Ordered commitments
  Validator->>ZK: Verify Groth16 proof if present
  Validator->>Account: Verify ERC-1271 signatures when configured
  Validator->>Validator: Sign ValidationAttestation
  Validator->>AttestReg: Best-effort anchor attestation hash
  Validator-->>A2A: Outcome + checks + attestation + trust graph + anchor
  A2A-->>Web: TrustValidation response
  Web-->>User: Provenance card + trust graph
```

## Trust Flow

```mermaid
flowchart TD
  Input["User reference"]
  Canonical["Canonical scripture locus"]
  Descriptor["ContentDescriptor"]
  Signature["Issuer signature"]
  Merkle["Merkle inclusion proof"]
  ZK["Groth16 zk membership\nleaf hidden"]
  Commitment["Text commitment"]
  Policy["Trust profile + access policy"]
  Citation["CitationAssertion"]
  Bundle["EvidenceBundle"]
  Attestation["ValidationAttestation"]
  Graph["Trust graph edges"]
  Anchor["Attestation anchor"]
  Validator["Validator outcome"]

  Input --> Canonical
  Canonical --> Descriptor
  Descriptor --> Signature
  Descriptor --> Merkle
  Descriptor --> ZK
  Descriptor --> Commitment
  Signature --> Policy
  Merkle --> Policy
  ZK --> Policy
  Commitment --> Citation
  Policy --> Citation
  Citation --> Bundle
  Bundle --> Validator
  Validator --> Attestation
  Validator --> Graph
  Attestation --> Anchor
```

Verification has four layers:

- Descriptor verification checks issuer signature and Merkle inclusion.
- Text verification checks that retrieved text matches the descriptor's commitment.
- ZK membership verification checks that the cited commitment is in the issuer corpus while hiding the leaf and index.
- Validator verification checks the evidence bundle, signed citation, policy/entitlement, response hash, and trust profile independently of the responding agent.
- Attestation verification checks that the validator signed the outcome and, when configured, that the compact attestation hash is anchored on-chain.

## Validator Flow

```mermaid
sequenceDiagram
  participant Agent as Responding Agent
  participant Validator as Third-Party Validator
  participant MCP
  participant ZK as zk-membership

  Agent->>Validator: POST /validate evidence bundle
  Validator->>Validator: Check bundle shape and canonical id
  Validator->>Validator: Verify descriptor signature + keccak Merkle inclusion
  Validator->>Validator: Check issuer trust profile
  Validator->>Validator: Verify text commitment and response hash
  Validator->>Validator: Verify policy / entitlement
  Validator->>Validator: Verify signed CitationAssertion binding
  Validator->>MCP: GET /corpus/:edition
  MCP-->>Validator: Ordered public commitments
  Validator->>ZK: Verify Groth16 membership proof
  ZK-->>Validator: valid / invalid
  Validator->>Validator: Sign ValidationAttestation
  Validator-->>Agent: validated / gated / rejected + attestation + graph
```

## Ask and Citation Flow

```mermaid
sequenceDiagram
  participant User
  participant Web
  participant A2A
  participant MCP
  participant Log as Transparency Log

  User->>Web: Ask question
  Web->>A2A: POST /ask
  A2A->>A2A: Match topic to configured passages
  loop each cited passage
    A2A->>MCP: Resolve + retrieve passage
    MCP-->>A2A: Descriptor + text + proof
    A2A->>A2A: Sign CitationAssertion
    A2A->>Log: Append citation summary
  end
  A2A-->>Web: Answer + citations
  Web-->>User: Answer with verifyable citations
```

The current demo uses a deterministic topic map instead of an LLM for `/ask`; the trust value is in the signed citations and transparency trail.

## Entitlement Flow

The MCP worker includes `/tools/issue_entitlement` for issuer-signed entitlement credentials. The web app requests a signed entitlement through A2A `/issue-entitlement`, and the stricter MCP text endpoint verifies the entitlement before serving non-public editions.

```mermaid
sequenceDiagram
  participant Client
  participant A2A
  participant MCP
  participant Issuer as Corpus Issuer

  Client->>A2A: Request licensed passage
  A2A->>MCP: get_passage_text without entitlement
  MCP-->>A2A: 403 access denied
  A2A-->>Client: Gate shown
  Client->>A2A: issue-entitlement(edition)
  A2A->>MCP: /tools/issue_entitlement
  MCP->>Issuer: Sign entitlement credential
  Issuer-->>MCP: EIP-712 proof
  MCP-->>A2A: Signed entitlement
  A2A-->>Client: Signed entitlement
  Client->>A2A: Retry resolve with entitlement
  A2A->>MCP: get_passage_text with entitlement
  MCP->>MCP: Verify structural credential + signer
  MCP->>MCP: Evaluate corpus access policy
  MCP-->>A2A: Licensed text if allowed
```

## Data Ownership

```mermaid
erDiagram
  EDITION ||--o{ DESCRIPTOR : publishes
  EDITION ||--|| CORPUS_MANIFEST : has
  CORPUS_MANIFEST ||--o{ DESCRIPTOR : commits
  DESCRIPTOR ||--|| VERSE_TEXT : points_to
  DESCRIPTOR ||--o{ CITATION_ASSERTION : supports
  ENTITLEMENT }o--|| CORPUS_MANIFEST : grants_access_to
  VALIDATION_BUNDLE }o--|| CITATION_ASSERTION : validates
  ZK_MEMBERSHIP_PROOF }o--|| CORPUS_MANIFEST : proves_member_of
  VALIDATION_ATTESTATION }o--|| VALIDATION_BUNDLE : attests_to
  TRUST_GRAPH_EDGE }o--|| VALIDATION_ATTESTATION : summarizes
  CORPUS_ANCHOR }o--|| CORPUS_MANIFEST : anchors
  ATTESTATION_ANCHOR }o--|| VALIDATION_ATTESTATION : anchors

  EDITION {
    string edition
    string version
    string displayName
    string accessPolicy
    string rightsStatus
  }
  CORPUS_MANIFEST {
    hex corpusRef
    address issuer
    hex corpusRoot
    string proofPolicy
  }
  DESCRIPTOR {
    string id
    hex canonicalId
    hex commitment
    string retrievalPointer
  }
  VERSE_TEXT {
    string osis
    string rendering
  }
  CITATION_ASSERTION {
    string canonicalId
    string descriptorId
    boolean commitmentVerified
  }
  ENTITLEMENT {
    string subject
    hex corpusRef
    string accessPolicy
  }
  VALIDATION_BUNDLE {
    string agentRunId
    string outputId
    hex responseHash
    string outcome
  }
  ZK_MEMBERSHIP_PROOF {
    string proof
    string publicSignals
  }
  VALIDATION_ATTESTATION {
    string validatorAgentId
    string subjectAgentId
    string evidenceBundleHash
    string checksHash
    string outcome
  }
  TRUST_GRAPH_EDGE {
    string from
    string rel
    string to
  }
  CORPUS_ANCHOR {
    hex corpusRef
    hex corpusRoot
    hex manifestHash
  }
  ATTESTATION_ANCHOR {
    hex attestationHash
    address validator
    bytes32 subjectAgent
  }
```

## Trust Boundaries

| Boundary | Risk | Control |
| --- | --- | --- |
| Browser to A2A | User input and display-only trust. | A2A re-orchestrates and does not trust UI verification. |
| A2A to MCP | Tool invocation and content access. | MCP policy gate and entitlement checks. |
| MCP to source text | Text integrity and rights leakage. | Commitments, public-domain scan, synthetic licensed data. |
| Descriptor to issuer | False provenance. | Signature verification against trusted issuer profile. |
| Descriptor to corpus | Descriptor not in corpus. | Merkle inclusion proof. |
| Agent to validator | Agent claims without evidence. | Evidence bundle and independent validator checks. |
| Validator to corpus privacy | Revealing exact corpus leaf/index. | Groth16 zk membership proof with public root and response signal only. |
| Validator to consumer | Validator can claim validation without accountability. | Signed `ValidationAttestation` and optional on-chain attestation anchor. |
| Trust graph to reality | Graph could overstate scope. | Edges are scoped to profile, run id, output id, descriptor id, and attestation hash. |
