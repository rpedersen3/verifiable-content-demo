# verifiable-content-demo

An example that consumes the **published `@agenticprimitives/*` npm packages** to
build a BibleGateway/YouVersion-style scripture lookup with verifiable
provenance. It is a *consumer* — it contains no agenticprimitives source, only
apps that `npm install` the primitives:

| Package (from npm) | Used for |
| --- | --- |
| [`@agenticprimitives/content-primitives`](https://www.npmjs.com/package/@agenticprimitives/content-primitives) | canonical-locus ids, signed `ContentDescriptor`s, commitments, candidate resolution, citations |
| [`@agenticprimitives/scripture-content-extension`](https://www.npmjs.com/package/@agenticprimitives/scripture-content-extension) | Bible canon (OSIS/USFM), versification, alias → one canonical locus |
| [`@agenticprimitives/tool-policy`](https://www.npmjs.com/package/@agenticprimitives/tool-policy) | MCP tool classification + policy decisions |
| [`@agenticprimitives/audit`](https://www.npmjs.com/package/@agenticprimitives/audit) | structured audit events |
| `@agenticprimitives/types` | branded `Address`/`Hex` types |

## The triad

```
apps/demo-bible-web  (:5175)  →  apps/demo-bible-a2a (:8791)  →  apps/demo-bible-mcp (:8790)
   verse + translation picker      resolve-scripture skill         tools + corpus
```

- **mcp** — resolves a reference to **candidate descriptors** across editions,
  verifies each (issuer signature + Merkle inclusion), and gates text retrieval
  by access policy / entitlement.
- **a2a** — a `resolve-scripture-passage` agent that orchestrates resolve → text →
  verify → build an enriched `CitationAssertion`.
- **web** — book / chapter / verse + edition picker with a provenance card
  (canonical locus id, issuer, commitment, "verified ✓", candidate list).

## Run it

```bash
pnpm install          # pulls the published @agenticprimitives/* packages from npm
pnpm dev              # mcp :8790 + a2a :8791 + web :5175
# open http://localhost:5175
```

In-process proof (no servers): `pnpm smoke`.

> **Versions.** `package.json` pins `@agenticprimitives/* @ ^1.0.0-alpha.6`. If the
> published release lands a different alpha, update the ranges to match. The repo
> only builds once those packages are live on npm.

## Rules (from ADR-0033, inherited by usage)

- **Public-domain text only** — ships the **Berean Standard Bible (BSB, CC0)**;
  a mock `demo-licensed` edition uses **synthetic** placeholder text to exercise
  the entitlement gate. Never a copyrighted work (`pnpm check:no-licensed-content`).
- **No verse text on-chain or in a published commitment** — descriptors carry a
  `retrievalPointer` + a SHA-256 commitment; text stays in this app's off-platform
  store.
- **Trust = issuer signature + access policy**, not the platform.

## On-chain trust mode (real Smart Agent issuer + agent-naming)

By default the demo verifies issuer signatures via EOA recovery and issues
signed Entitlement/Citation VCs with dev keys. There's also a **real on-chain
path** where the issuer is an **ERC-4337 Smart Agent** (ERC-1271 signatures),
resolved by name via **`@agenticprimitives/agent-naming`**.

`apps/demo-bible-mcp/scripts/bootstrap-onchain.ts` proves it end-to-end against a
local chain with the agenticprimitives contracts deployed:

```bash
# 1. in the agenticprimitives repo: run a chain + deploy the contracts
anvil &                                   # or: pnpm dev (which also deploys)
cd packages/contracts && pnpm deploy:anvil

# 2. here: bootstrap the on-chain issuer + prove the trust round-trip
pnpm --filter @verifiable-content-demo/bible-mcp exec tsx scripts/bootstrap-onchain.ts
#   → creates an issuer Smart Agent (AgentAccount)
#   → ERC-1271 isValidSignature: OK
#   → registers bsb.agent → resolves to the issuer SA (agent-naming)
#   → builds a real ContentDescriptor, signs it via the SA, and verifies it
#     through content-primitives against the SA's isValidSignature: OK
```

It writes `apps/demo-bible-mcp/onchain.json` (gitignored). Threading this into the
live Worker request path (env-injected RPC + per-request ERC-1271 verification)
is the next increment; the bootstrap demonstrates the primitive today.

Built on the Verifiable Content Substrate (agenticprimitives specs 266/267).
