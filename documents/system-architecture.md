# System Architecture

## Purpose

The system demonstrates verifiable scripture lookup using three bounded components: a user interface, an A2A orchestration agent, and an MCP content/tool server. Trust is attached to descriptors, commitments, issuer signatures, and policy decisions rather than to the UI.

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

  Web --> A2A
  A2A --> MCP
  MCP --> Registry
  MCP --> Corpus
  MCP --> TextStore
  MCP --> Policy
  MCP --> Audit
```

## Responsibilities

| Component | Responsibility | Does Not Own |
| --- | --- | --- |
| Web | User interaction, result rendering, provenance display. | Descriptor verification or corpus building. |
| A2A | Orchestrates resolve, text retrieval, verification, and citation building. | Raw corpus data or trust policy configuration. |
| MCP | Owns tools, corpora, policy gates, entitlement checks, descriptor verification, and audit. | UI decisions. |
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
  A2A->>A2A: Build CitationAssertion
  A2A-->>Web: Result, provenance, citation
  Web-->>User: Verse or gate + evidence
```

## Trust Flow

```mermaid
flowchart TD
  Input["User reference"]
  Canonical["Canonical scripture locus"]
  Descriptor["ContentDescriptor"]
  Signature["Issuer signature"]
  Merkle["Merkle inclusion proof"]
  Commitment["Text commitment"]
  Policy["Trust profile + access policy"]
  Citation["CitationAssertion"]

  Input --> Canonical
  Canonical --> Descriptor
  Descriptor --> Signature
  Descriptor --> Merkle
  Descriptor --> Commitment
  Signature --> Policy
  Merkle --> Policy
  Commitment --> Citation
  Policy --> Citation
```

Verification has two layers:

- Descriptor verification checks issuer signature and Merkle inclusion.
- Text verification checks that retrieved text matches the descriptor's commitment.

## Entitlement Flow

The MCP worker includes `/tools/issue_entitlement` for issuer-signed entitlement credentials. The current web UI builds a local demo entitlement shape, while the stricter MCP text endpoint expects signed entitlements for non-public editions.

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
  Client->>MCP: issue_entitlement(edition, subject)
  MCP->>Issuer: Sign entitlement credential
  Issuer-->>MCP: EIP-712 proof
  MCP-->>Client: Signed entitlement
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
```

## Trust Boundaries

| Boundary | Risk | Control |
| --- | --- | --- |
| Browser to A2A | User input and display-only trust. | A2A re-orchestrates and does not trust UI verification. |
| A2A to MCP | Tool invocation and content access. | MCP policy gate and entitlement checks. |
| MCP to source text | Text integrity and rights leakage. | Commitments, public-domain scan, synthetic licensed data. |
| Descriptor to issuer | False provenance. | Signature verification against trusted issuer profile. |
| Descriptor to corpus | Descriptor not in corpus. | Merkle inclusion proof. |
