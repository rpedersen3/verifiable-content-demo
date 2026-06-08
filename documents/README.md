# Architecture Documents

This folder explains the `verifiable-content-demo` architecture and trust model:

- [Branding Approach](./branding-approach.md) - value narrative, differentiation from YouVersion-style products, and stakeholder messaging.
- [Agentic Trust Technical Description](./agentic-trust-technical-description.md) - simple technical explanation of validators, translation agents, and shared response evidence.
- [Initialization and Data Sources](./initialization-and-data-sources.md) - how verse data, edition registries, corpora, contract registries, and validator data sources are initialized.
- [Information Architecture](./information-architecture.md) - user-facing concepts, labels, content objects, and navigation model.
- [Operational Architecture](./operational-architecture.md) - local services, ports, scripts, runtime dependencies, checks, and observability.
- [System Architecture](./system-architecture.md) - component boundaries, trust boundaries, data flow, and entitlement flow.
- [Technical Architecture](./technical-architecture.md) - implementation details, package layout, APIs, domain types, and extension points.

The demo is a multi-package workspace:

```mermaid
flowchart TB
  Web["demo-bible-web\nReact + Vite\n:5175"]
  A2A["demo-bible-a2a\nHono Worker\n:8791"]
  MCP["demo-bible-mcp\nHono Worker\n:8790"]
  Validator["demo-validator\nHono Node service\n:8792"]
  ZK["zk-membership\nGroth16 + Poseidon"]
  AgentNaming["Agent Naming\nregistry + resolver"]
  AgentAccount["Agent Account\nSmart Agent + ERC-1271"]
  CorpusRegistry["ContentCorpusRegistry\ncorpus roots"]
  AttestationRegistry["ValidationAttestationRegistry\nattestation anchors"]

  Web -->|"lookup, ask, validate"| A2A
  A2A -->|"resolve, text, entitlement"| MCP
  A2A -->|"EvidenceBundle"| Validator
  Validator -->|"GET /corpus/:edition"| MCP
  Validator --> ZK
  MCP --> AgentNaming
  MCP --> AgentAccount
  MCP --> CorpusRegistry
  Validator --> AgentAccount
  Validator --> AttestationRegistry
```

Core principle: verse text stays in the app's off-platform store; verifiability comes from canonical scripture loci, issuer-signed content descriptors, commitments, Merkle inclusion, optional Groth16 zk membership, entitlement policy, signed citations, signed validation attestations, trust graph edges, and independent validator checks.

The working demo covers these flows:

- Lookup: web -> A2A -> MCP -> signed `CitationAssertion`.
- Ask: web -> A2A topic answer -> multiple signed citations -> in-memory transparency log.
- Entitlement: web -> A2A -> MCP signed entitlement -> gated content retry.
- Validation: A2A assembles `EvidenceBundle` -> hosted validator -> `ValidationAttestation` + trust graph + optional on-chain attestation anchor.
- ZKP: `validate:e2e` builds a Groth16 membership proof locally and the hosted validator verifies it.
- On-chain trust: MCP verifies issuer Smart Agent signatures through ERC-1271 and reads corpus roots from `ContentCorpusRegistry`.
