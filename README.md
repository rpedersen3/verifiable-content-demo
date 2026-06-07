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

Built on the Verifiable Content Substrate (agenticprimitives specs 266/267).
