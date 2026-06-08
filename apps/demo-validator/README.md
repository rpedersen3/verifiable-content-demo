# demo-validator — independent third-party validator agent

A validator that does **not** trust the responding agent. Given an agentic-trust
**evidence bundle**, it re-derives and checks every claim and returns
**validated / gated / rejected** with per-check results.

```bash
# 1. zk setup (once) + run the triad in DEV mode (no .dev.vars)
pnpm zk:setup
pnpm dev

# 2. end-to-end: an agent assembles a bundle (+ Groth16 zk proof); the validator checks it
pnpm validate:e2e

# or run it as a service (POST /validate)
pnpm validator    # :8792
```

## What it checks (`src/validate.ts`)

| Check | What it proves |
| --- | --- |
| `schema` | the bundle has the required sections |
| `canonicalReference` | `canonicalId == hash(canonicalEnvelope)` (content-primitives) |
| `descriptorMatchesReference` | the descriptor is for that canonical reference |
| `descriptorSignatureAndInclusion` | issuer signed the descriptor **and** its commitment is in the corpus root (keccak Merkle) |
| `issuerTrusted` | the issuer is admitted by the validator's trust profile |
| `commitmentMatchesText` | the served text hashes to the descriptor commitment |
| `policy` | public allowed, or a valid issuer-signed entitlement scoped to the corpus |
| `citationSignature` | the responding agent signed the CitationAssertion |
| `citationBinding` | the citation's `{canonicalId, descriptorId, commitment, agentRunId, outputId}` match the response |
| `responseBinding` | `responseHash == keccak(text)` |
| `zkMembership` | **Groth16 zk-SNARK**: the commitment is a member of the issuer's Poseidon corpus root (leaf hidden) — root re-derived from the issuer's published commitments |

The `e2e` demonstrates an **honest** bundle (→ validated), a **tampered** response
(→ rejected: commitment + response-binding fail), and an **untrusted-issuer**
profile (→ rejected). On-chain issuers (ERC-1271) are admitted by injecting an
`AgentAccountClient`-backed `verifySignature` + resolving `issuerName` via
agent-naming — the same pattern the MCP uses.
