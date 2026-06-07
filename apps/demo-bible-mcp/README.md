# demo-bible-mcp — scripture resolver (MCP)

Resolves scripture passages via the **verifiable-content** naming/descriptor
approach (specs 266 / 267). Part of the scripture demo triad:

```
demo-bible-web  (:5175)  →  demo-bible-a2a (:8791)  →  demo-bible-mcp (:8790)
   verse picker UI            resolve-scripture skill      tools + corpus
```

Run the whole triad: `pnpm dev:bible` (or `pnpm dev:bible-mcp` / `-a2a` / `-web`
individually). Quick proof without servers: `pnpm smoke:bible`.

## Tools

- `GET /mcp/editions` — the edition registry (public).
- `GET /mcp/books` — the OSIS book table (for the picker).
- `POST /tools/resolve_passage {reference, edition}` — a **verified**
  `ContentDescriptor` + provenance. **No verse text.**
- `POST /tools/get_passage_text {reference, edition, entitlement?}` — text,
  gated by the corpus access policy (`public` → open; `licensed`/`private` →
  requires a matching `Entitlement`).
- `POST /tools/verify_citation {reference, edition, commitment}` — re-check.

## Rules (ADR-0033)

- **Public-domain only.** Ships exactly one CC0 edition — the Berean Standard
  Bible (BSB). A mock `demo-licensed` edition uses **synthetic** placeholder text
  (never a copyrighted work) to exercise the entitlement gate.
- **No verse text on-chain / in a published commitment.** Text lives in this
  app's off-platform store (`src/data/`); only keccak commitments + a Merkle
  `corpusRoot` are published. Enforced by `pnpm check:no-licensed-content`.

## Add a translation (data + config, no code change — R2)

1. Add the rendering text keyed by OSIS path in a new `src/data/<edition>.ts`
   (public-domain editions only — see `src/data/bsb.ts`).
2. Append an `EditionEntry` to `EDITIONS` in `src/editions/registry.ts`
   (`edition`, `version`, `displayName`, `issuerName`, `accessPolicy`, `texts`).
3. That's it — the corpus is committed (descriptors + Merkle root) on boot, and
   the new edition appears in `list_editions` and the web picker automatically.

**Rights holders** publishing a *copyrighted* edition do NOT add it here. They
run the generic `@agenticprimitives/content-primitives` SDK on their own
infrastructure to publish a signed `CorpusManifest` + `ContentDescriptor`s
(pointers + commitments, never text) under their own license terms (ADR-0033 R5).
