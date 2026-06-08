# verifiable-content-demo — working rules

A consumer of the published `@agenticprimitives/*` packages: a scripture-lookup demo
with verifiable provenance, plus a PROV-O Bible knowledge graph (`apps/demo-bible-ontology`)
used to validate the Global Church Ontology. See `README.md` for architecture.

## Data integrity (the top priority)

**Data integrity is critical in this repo. Treat every record's binding to a canonical
identity as a claim that must be earned, not assumed.**

- **Match to a canonical id with high confidence.** When bringing in any external/secondary
  data (Wikidata, images, cross-references, a new corpus, a new metadata source), resolve it
  to an existing canonical id (the node's stable `id` / `canon_id`) by a deliberate, verifiable
  method — not a bare name match. Names collide (8 people are named "Simon"; "Joseph" is both a
  patriarch and Mary's husband). Prefer stable identifiers (recID, slug, Wikidata QID, GeoNames)
  and verify the match (e.g. confirm the resolved entity's label/description before trusting it).
- **Always record a confidence score + method.** Every node carries `canon_confidence` (0..1),
  `canon_method`, and `canon_basis`. `1.0` is a native, authoritative source id; anything lower
  is a fuzzy/heuristic match and must say *why* in `canon_basis`. Never attach brought-in data
  without setting these. **Never silently upgrade a low-confidence match to look certain.**
- **Surface suspect matches; don't hide them.** Low-confidence bindings must remain visible in
  the API/UI (and `/api/integrity`) so a human can review them. If coverage is capped, sampled,
  or a match was dropped, `log()`/comment it — silent truncation reads as "fully matched" when it
  isn't.
- **Source of truth is the committed build inputs.** `.data/` is gitignored and regenerated;
  the canonical inputs are `schema.sql`, the build scripts, and curated data under
  `apps/*/data/` (e.g. `wikidata-enrichment.json`). Don't hand-edit generated `.data/ontology/*`.
- **Licensing travels with the data.** Carry per-record license + attribution for anything
  ingested (verse text editions, images); see the README attribution sections.

## Trust ontology (agentic trust)

Trust is modeled as multi-dimensional, provenance-grounded signals — the same principles we apply
to agentic trust. Keep these first-class and additive:
- **Corroboration as a trust signal.** A source's claim about an entity is a DOLCE+DnS
  **`dns:Assertion`** (stored in `node_source`). Multiple *independent, authoritative* sources
  asserting the same entity — especially with *agreeing stable ids* (Wikidata/Pleiades/GeoNames) —
  raise trust. That derived signal is the `source_trust` score, a **`gc:SourceAssessment`**
  (⊂ `gc:Assessment` ⊂ `dns:Assertion`). A single-source assertion is weaker; never treat it as
  settled fact.
- **Separate identity-match confidence from entity-trust.** `canon_confidence` answers "is this data
  bound to the right canonical id?"; the `score` dimensions (moral, graph, scriptural, historical,
  source) answer "how trustworthy/attested is the entity?" Don't conflate them.
- **Model assertions/assessments with DOLCE+DnS terms** where possible (`dns:Assertion`,
  `dul:Situation`/`Description`, `dul:satisfies`, `gc:Attestation`, `gc:Assessment`) rather than ad-hoc
  fields, so the trust layer stays ontologically aligned and portable to other agentic-trust work.

## Conventions
- pnpm workspace + TypeScript. `pnpm typecheck` before considering a change done.
- Cloudflare Workers (MCP/A2A/ontology) via `wrangler`; web is Vite/React; validator is Node/Vercel.
- Ontology rebuild + **fast local verification** flow: see `apps/demo-bible-ontology/README.md`
  (seed local D1, bulk-load chunks into the miniflare sqlite, `wrangler dev`, curl `/api/*`).
