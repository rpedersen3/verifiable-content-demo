# Information Architecture

## Purpose

The demo presents scripture lookup as a user-facing reading experience backed by verifiable provenance. The information architecture separates what the user chooses, what the system resolves, what is allowed to be displayed, and what evidence proves the citation.

## Primary User Model

Users think in this order:

1. Choose a translation.
2. Choose a book, chapter, and verse.
3. Read the verse if access is allowed.
4. Inspect provenance if they want to understand why the result is trustworthy.
5. Review alternate candidates when more than one descriptor exists.

```mermaid
flowchart TD
  Start["Open Verse Lookup"]
  Choose["Choose translation + passage"]
  Resolve["Resolve passage"]
  Access{"Text accessible?"}
  Verse["Show verse text"]
  Gate["Show entitlement gate"]
  Provenance["Show provenance card"]
  Candidates["Show candidate list"]
  Citation["Expose citation record"]

  Start --> Choose --> Resolve --> Access
  Access -->|yes| Verse
  Access -->|no| Gate
  Verse --> Provenance
  Gate --> Provenance
  Provenance --> Candidates
  Provenance --> Citation
```

## User-Facing Objects

| Object | User Label | Meaning |
| --- | --- | --- |
| Edition | Translation | A specific published corpus version, such as `bsb` or `demo-licensed`. |
| Passage | Book, chapter, verse | The user's requested scripture reference. |
| Canonical locus | Canonical locus id | A normalized, scheme-independent identifier for the verse. |
| Candidate | Candidate | A content descriptor that could satisfy the canonical locus. |
| Commitment | Commitment | A cryptographic digest of normalized text. |
| Provenance | Provenance | The trust evidence for the selected candidate. |
| CitationAssertion | Citation record | The AI-safe output record binding the result to the descriptor and commitment. |
| Entitlement | Demo entitlement | A credential used to unlock non-public text. |

## Content Hierarchy

```mermaid
flowchart TD
  Corpus["Corpus / Edition"]
  Manifest["CorpusManifest\nissuer, edition, version, root, policy"]
  Descriptor["ContentDescriptor\ncanonical id, selector, commitment, pointer"]
  Text["Off-platform verse text\napps/demo-bible-mcp/src/data"]
  Citation["CitationAssertion\nagent output evidence"]

  Corpus --> Manifest
  Corpus --> Descriptor
  Descriptor --> Text
  Descriptor --> Citation
  Manifest --> Descriptor
```

## Page Structure

The web app is organized as:

- Header: product name and provenance-oriented tagline.
- Picker card: edition, book, chapter, verse, and lookup action.
- Result card: resolved reference and verse text or access gate.
- Provenance card: canonical id, issuer, OSIS locus, access policy, commitment, and verification state.
- Candidate list: admitted and screened descriptor candidates.
- Citation details: raw `CitationAssertion` JSON.

## Information Flow

```mermaid
sequenceDiagram
  participant User
  participant UI as Web UI
  participant Agent as A2A Agent
  participant Tools as MCP Tools

  User->>UI: Select edition and passage
  UI->>Agent: POST /resolve
  Agent->>Tools: POST /tools/resolve
  Tools-->>Agent: Canonical locus + candidates
  Agent->>Tools: POST /tools/get_passage_text
  Tools-->>Agent: Text or access denial
  Agent-->>UI: Result + provenance + citation
  UI-->>User: Verse or gate + trust evidence
```

## Naming Rules

- Use "translation" for users; use "edition" in technical docs and APIs.
- Use "passage" or "reference" for the user's input.
- Use "canonical locus" for the normalized scripture identity.
- Use "provenance" for the evidence card, not for the verse text itself.
- Use "candidate" for possible descriptors, because the resolver can return more than one.
