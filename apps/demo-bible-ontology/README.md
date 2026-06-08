# demo-bible-ontology

A **PROV-O knowledge graph of the Bible** used to **validate the Global Church Ontology**
against PROV-O and real Bible usage. Live:
https://demo-bible-ontology-production.richardpedersen3.workers.dev

## Ontology layers
- **DUL** (upper) — Object / Event / Agent / Place / Role / Concept / Description / Situation
- **DnS + BDI + DIKW** (upper) — Descriptions & Situations + Assertion; Belief-Desire-Intention;
  Knowledge↔Wisdom (Data→Information→Knowledge→Understanding→Wisdom)
- **PROV-O** (the priority) — `prov:Agent` (Person/Organization) · `prov:Activity` · `prov:Entity`
- **W3C ORG** — typed organizations + reified `org:Membership` + `org:Role`/`org:Post`
- **GeoSPARQL** — `geo:Feature` + geometry (WKT) on every place
- **OWL-Time** — lifespans/event years (`prov:startedAtTime`/`endedAtTime`)
- **aps:** (agenticprimitives skills) — `aps:Skill` / `aps:hasSkill`
- **gc:** (Global Church + Bible-lower) — org types, roles, responsibilities, trust signals

## Instances (from Theographic) — verse-linked throughout
3,067 people (Agent) · 23 typed orgs · 450 events (Activity) · 1,274 places (Entity + geo) ·
843 reified memberships · roles / skills / responsibilities · 53,120 node↔verse links.
Positive/negative **trust signals** (assessments) on key agents + activities.

## Canonical identity, images & signals
- **Canonical ids** — every node has a globally-unique stable id (the Theographic recID, survives
  name collisions) plus a human-readable `canon_id` slug (`david_994`, `peter_2745`) and a short
  `disambig` (role + lifespan / feature type). Two of the eight "Simon"s are `peter_2745` vs
  `simon_2746` — same name, distinct canonical id.
- **Canonical-id confidence (data integrity)** — every node records `canon_confidence` (0..1),
  `canon_method`, `canon_basis`. Native Theographic ids are **1.0 / `source`** (rock-solid). Any
  brought-in data (Wikidata/images) is scored by match strength — exact-unique ≈ 0.97+, a
  name-collision resolved only by verse-dominance or a label-mismatch (slug-prefix) match is lower
  and **flagged for review**, never silently trusted. `GET /api/integrity?max=0.9` lists suspect
  bindings weakest-first (e.g. it surfaces that Wikidata `Q51672` matched the node labeled
  "Herod Antipas" at 0.71). Reviewable in **Admin → data integrity**. See `/CLAUDE.md`.
- **External authority + images** — ~80 key figures/places/events are linked to **Wikidata**
  (`wikidata`) and carry a **licensed image** from **Wikimedia Commons** (`image_url`/`image_thumb`
  with `image_license`/`image_attr`). Curated, verified map in `data/wikidata-enrichment.json`
  (regenerate with `node scripts/fetch-enrichment.mjs`). A consistent **app-style render** is derived
  from the source; `image_styled_url` reserves a slot for a generative backfill. The **Admin** tab
  toggles source / app-style / both.
- **Multi-dimensional trust** (`score` table, one row per subject × dimension):
  `moral` good↔evil −1..+1 (curated, seeded from signals) · `graph_trust` 0..1 (computed: graph
  connectivity) · `scriptural_trust` 0..1 (computed: verse coverage) · `historical_trust` 0..1
  (curated: archaeology / extra-biblical records, e.g. David ← Tel Dan Stele) · `source_trust` 0..1
  (computed: independent-source **corroboration**).

## Multi-source A-box + trust ontology
External datasets are reconciled onto the Theographic canonical backbone — each record bound to a
canonical id with a recorded **match confidence + SKOS relation** (`xref`), its **license/attribution**
(`source`), and its claim stored as a DOLCE+DnS **`dns:Assertion`** (`node_source`). Unmatched
entities **mint new canonical nodes** (origin-tagged, lower confidence). Brought in so far:
- **STEPBible TIPNR** (CC BY) — original-language **Hebrew/Greek forms + Strong's** (`node_form`),
  exhaustive proper-noun ids, family links; +573 new canonical nodes.
- **OpenBible Geocoding** (CC BY) — refined coordinates, modern identifications, and external links
  to **Wikidata / Pleiades / GeoNames**; +474 new places.

**Corroboration is a trust signal** (agentic-trust principle): independent, authoritative sources
asserting the same entity — especially with *agreeing stable ids* — raise the `source_trust` score, a
**`gc:SourceAssessment`** (⊂ `gc:Assessment` ⊂ `dns:Assertion`). Identity-match confidence
(`canon_confidence`) is kept distinct from entity trust (the `score` dimensions). ~12.9k cross-refs,
~5.8k original-language forms across 6 sources.

## Inheritance (subclass closure)
`class_closure` stores the transitive `rdfs:subClassOf*` of every class, so a query for a parent
class resolves **all descendants across every layer**: `GET /api/class?curie=prov:Agent` returns
**3,090** instances (people + organizations, 13 subclasses) — a naive `prov_class='prov:Agent'`
exact match returns **0**. The **Inheritance** tab demonstrates this interactively.

## Validation
`gco_term` holds the real GCO classes with their computed PROV-O alignment (walking
`rdfs:subClassOf` into PROV-O/DUL): of 114 classes, ~78 align to a PROV-O class, 11 are DnS
constructs, 25 are unaligned (review candidates). See the "Validate GCO" tab.

## Rebuild
```
node scripts/fetch-sources.mjs       # fetch raw TIPNR + OpenBible dumps → .data/sources/ (gitignored)
node scripts/fetch-enrichment.mjs    # (optional) refresh Wikidata/Commons images → data/wikidata-enrichment.json
node scripts/build-ontology.mjs      # Theographic + enrichment + sources → ontology SQL (.data/ontology/)
                                     #   emits node (canon_id, images, origin), class_closure, score,
                                     #   signal, source, xref, node_source (dns:Assertion), node_form
node scripts/parse-gco.mjs           # GCO core.jsonld → gco_term with PROV-O alignment
wrangler d1 execute bible-ontology --remote --file=schema.sql
# then import .data/ontology/*.sql (chunked)
```

## Attribution / licenses
- **Theographic Bible Metadata** — people/places/events/relationships — © robertrouse,
  licensed **CC-BY-SA 4.0**. https://github.com/robertrouse/theographic-bible-metadata
- **STEPBible TIPNR** — proper-noun ids, Hebrew/Greek forms, Strong's — © STEPBible.org / Tyndale
  House Cambridge, **CC BY 4.0**. Per their request, refer to github.com/STEPBible as the source; we
  redistribute only derived data, not the raw file.
- **OpenBible.info Bible Geocoding** — place coordinates, modern identifications, linked ids —
  **CC BY 4.0** (geometry ODbL via OpenStreetMap). https://www.openbible.info/geo/
- **Pleiades** (CC BY 3.0) and **GeoNames** (CC BY 4.0) — place authority cross-references.
- **Wikidata** (canonical entity ids, CC0) and **Wikimedia Commons** (entity images) — each image
  carries its own license + author in `image_license` / `image_attr` (public-domain or CC-BY-SA).
- Global Church Core Ontology — https://ontology.global.church/core
- PROV-O (W3C), DOLCE-UltraLite, W3C ORG, GeoSPARQL, OWL-Time — standard vocabularies.
