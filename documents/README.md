# Architecture Documents

This folder explains the `verifiable-content-demo` architecture from four angles:

- [Information Architecture](./information-architecture.md) - user-facing concepts, labels, content objects, and navigation model.
- [Operational Architecture](./operational-architecture.md) - local services, ports, scripts, runtime dependencies, checks, and observability.
- [System Architecture](./system-architecture.md) - component boundaries, trust boundaries, data flow, and entitlement flow.
- [Technical Architecture](./technical-architecture.md) - implementation details, package layout, APIs, domain types, and extension points.

The demo is a three-app workspace:

```mermaid
flowchart LR
  Web["demo-bible-web\nReact + Vite\n:5175"]
  A2A["demo-bible-a2a\nHono Worker\n:8791"]
  MCP["demo-bible-mcp\nHono Worker\n:8790"]

  Web -->|"GET /a2a/editions\nGET /a2a/books\nPOST /a2a/resolve"| A2A
  A2A -->|"GET /mcp/editions\nGET /mcp/books\nPOST /tools/*"| MCP
```

Core principle: verse text stays in the app's off-platform store; verifiability comes from canonical scripture loci, issuer-signed content descriptors, commitments, Merkle inclusion, and entitlement policy.
