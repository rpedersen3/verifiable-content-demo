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

## Validation
`gco_term` holds the real GCO classes with their computed PROV-O alignment (walking
`rdfs:subClassOf` into PROV-O/DUL): of 114 classes, ~78 align to a PROV-O class, 11 are DnS
constructs, 25 are unaligned (review candidates). See the "Validate GCO" tab.

## Rebuild
```
node scripts/build-ontology.mjs      # Theographic → ontology SQL (.data/ontology/)
node scripts/parse-gco.mjs           # GCO core.jsonld → gco_term with PROV-O alignment
wrangler d1 execute bible-ontology --remote --file=schema.sql
# then import .data/ontology/*.sql (chunked)
```

## Attribution / licenses
- **Theographic Bible Metadata** — people/places/events/relationships — © robertrouse,
  licensed **CC-BY-SA 4.0**. https://github.com/robertrouse/theographic-bible-metadata
- Global Church Core Ontology — https://ontology.global.church/core
- PROV-O (W3C), DOLCE-UltraLite, W3C ORG, GeoSPARQL, OWL-Time — standard vocabularies.
