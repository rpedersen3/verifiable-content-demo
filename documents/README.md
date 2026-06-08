# Architecture Documents

This folder explains the `verifiable-content-demo` architecture and trust model:

- [Branding Approach](./branding-approach.md) - value narrative, differentiation from YouVersion-style products, and stakeholder messaging.
- [Agentic Trust Technical Description](./agentic-trust-technical-description.md) - simple technical explanation of validators, translation agents, and shared response evidence.
- [Information Architecture](./information-architecture.md) - user-facing concepts, labels, content objects, and navigation model.
- [Operational Architecture](./operational-architecture.md) - local services, ports, scripts, runtime dependencies, checks, and observability.
- [System Architecture](./system-architecture.md) - component boundaries, trust boundaries, data flow, and entitlement flow.
- [Technical Architecture](./technical-architecture.md) - implementation details, package layout, APIs, domain types, and extension points.

The demo is a multi-package workspace:

```mermaid
flowchart LR
  Web["demo-bible-web\nReact + Vite\n:5175"]
  A2A["demo-bible-a2a\nHono Worker\n:8791"]
  MCP["demo-bible-mcp\nHono Worker\n:8790"]
  Validator["demo-validator\nHono Node service\n:8792"]
  ZK["zk-membership\nGroth16 + Poseidon"]

  Web -->|"GET /a2a/editions\nGET /a2a/books\nPOST /a2a/resolve"| A2A
  A2A -->|"GET /mcp/editions\nGET /mcp/books\nPOST /tools/*"| MCP
  A2A -->|"resolve response + signed citation"| Validator
  Validator -->|"GET /corpus/:edition"| MCP
  Validator --> ZK
```

Core principle: verse text stays in the app's off-platform store; verifiability comes from canonical scripture loci, issuer-signed content descriptors, commitments, Merkle inclusion, optional Groth16 zk membership, entitlement policy, signed citations, and independent validator checks.
