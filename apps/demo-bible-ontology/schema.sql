-- Bible ontology graph: DUL ⊃ PROV-O ⊃ {ORG, GeoSPARQL, aps:} ⊃ gc: (lower).
CREATE TABLE IF NOT EXISTS ontology_class (curie TEXT PRIMARY KEY, label TEXT, layer TEXT, parent TEXT, comment TEXT);
CREATE TABLE IF NOT EXISTS ontology_prop (curie TEXT PRIMARY KEY, label TEXT, layer TEXT, domain TEXT, range_ TEXT, inverse TEXT, comment TEXT);
-- Transitive subclass closure (ancestor ⊇ class). Every class is its own ancestor at depth 0.
-- Lets a query for prov:Agent pick up gc:Person, gc:Nation, … without walking the hierarchy at read time.
CREATE TABLE IF NOT EXISTS class_closure (class TEXT, ancestor TEXT, depth INTEGER, PRIMARY KEY (class, ancestor));
CREATE TABLE IF NOT EXISTS node (
  id TEXT PRIMARY KEY,        -- globally-unique stable id (Theographic recID); survives name collisions
  canon_id TEXT,             -- human-readable canonical id / slug (e.g. david_994) — disambiguates same-named people
  canon_confidence REAL,     -- 0..1: confidence that data on this node is correctly bound to its canonical id (1.0 = native source id; lower = fuzzy external match)
  canon_method TEXT,         -- how the binding was established: source | exact-label | slug-prefix | curated-alias | title-exact | title-alias
  canon_basis TEXT,          -- human explanation of the match + any name-collision resolution
  label TEXT, kind TEXT,
  disambig TEXT,             -- short human disambiguator (role + lifespan / feature type) for same-named entities
  aka TEXT,                  -- "also known as" search blob (label + canonical-slug name + aliases), lowercased
  prov_class TEXT, dul_class TEXT, org_class TEXT, geo_class TEXT, gc_class TEXT, aps_class TEXT,
  lat REAL, long REAL, wkt TEXT, t_start INTEGER, t_end INTEGER,
  wikidata TEXT,             -- external authority URI (Wikidata entity)
  authority_uri TEXT,        -- secondary authority (GeoNames for places, dictionary for people)
  image_url TEXT,            -- full Wikimedia Commons source image (original)
  image_thumb TEXT,          -- scaled source thumbnail
  image_license TEXT,        -- license short name (e.g. Public domain, CC BY-SA 4.0)
  image_attr TEXT,           -- attribution / author
  image_styled_url TEXT,     -- consistent-style derived portrait (generative backfill); null ⇒ app derives the style from the source at render time
  origin_source TEXT,        -- which source first minted this canonical node (theographic | tipnr | openbible | …)
  meta TEXT
);
-- ─── Multi-source A-box provenance (data integrity) ───────────────────────────
-- Source registry: every external dataset we ingest, with its license + attribution.
CREATE TABLE IF NOT EXISTS source (source_id TEXT PRIMARY KEY, name TEXT, abbrev TEXT, url TEXT, license TEXT, attribution TEXT, retrieved TEXT);
-- Cross-references: node ↔ external authority/source id, with match confidence + method + SKOS relation
-- (exactMatch when a stable id agrees; closeMatch when reconciled heuristically).
CREATE TABLE IF NOT EXISTS xref (node_id TEXT, scheme TEXT, value TEXT, uri TEXT, relation TEXT, match_confidence REAL, match_method TEXT, source_id TEXT, PRIMARY KEY (node_id, scheme, value));
-- Provenance: which sources attest a node. Each row is a reified DOLCE+DnS dns:Assertion — a source
-- (Agent) asserting information about the entity, with the source's own ref/label + attestation
-- confidence. Independent agreeing assertions feed the source_trust (gc:SourceAssessment) signal.
CREATE TABLE IF NOT EXISTS node_source (node_id TEXT, source_id TEXT, src_ref TEXT, src_label TEXT, confidence REAL, PRIMARY KEY (node_id, source_id));
-- Original-language forms (Hebrew/Greek + Strong's), from TIPNR.
CREATE TABLE IF NOT EXISTS node_form (node_id TEXT, lang TEXT, form TEXT, translit TEXT, strongs TEXT, source_id TEXT);
-- Legacy categorical trust signal (positive/negative/mixed) — kept for back-compat with the graph viz.
CREATE TABLE IF NOT EXISTS signal (id INTEGER PRIMARY KEY AUTOINCREMENT, subject_id TEXT, polarity TEXT, basis TEXT, osis TEXT);
-- Multi-dimensional trust/alignment scores. One row per (subject, dimension):
--   moral            good↔evil alignment            −1 … +1   (curated, seeded from signals)
--   graph_trust      strength of position in graph    0 … 1    (computed: connectivity)
--   scriptural_trust weight of biblical attestation   0 … 1    (computed: verse coverage)
--   historical_trust extra-biblical corroboration     0 … 1    (curated: archaeology / records)
--   source_trust     independent source corroboration 0 … 1    (computed: DnS assertions agreeing)
CREATE TABLE IF NOT EXISTS score (subject_id TEXT, dimension TEXT, value REAL, basis TEXT, method TEXT, PRIMARY KEY (subject_id, dimension));
CREATE TABLE IF NOT EXISTS edge (id INTEGER PRIMARY KEY AUTOINCREMENT, src TEXT, rel TEXT, dst TEXT, ctx TEXT);
CREATE TABLE IF NOT EXISTS node_verse (node_id TEXT, osis TEXT);
-- Real Global Church Ontology terms (pulled) for validation against PROV-O + Bible usage.
CREATE TABLE IF NOT EXISTS gco_term (curie TEXT PRIMARY KEY, label TEXT, type TEXT, parent TEXT, prov_align TEXT, comment TEXT);
-- Berean Standard Bible verse text (public domain, CC0) + paragraph boundaries (logical grouping,
-- from the BSB USFX paragraphing) so a clicked verse opens its surrounding passage to read.
CREATE TABLE IF NOT EXISTS corpus (edition TEXT PRIMARY KEY, version TEXT, corpus_ref TEXT, corpus_root TEXT, leaf_count INTEGER, issuer TEXT);
CREATE TABLE IF NOT EXISTS verses (edition TEXT, canonical_id TEXT, osis TEXT, leaf_index INTEGER, commitment TEXT, text TEXT, PRIMARY KEY (edition, canonical_id));
CREATE TABLE IF NOT EXISTS paragraph (start_idx INTEGER PRIMARY KEY);  -- leaf_index where each paragraph begins
CREATE INDEX IF NOT EXISTS idx_edge_src ON edge(src);
CREATE INDEX IF NOT EXISTS idx_edge_dst ON edge(dst);
CREATE INDEX IF NOT EXISTS idx_edge_rel ON edge(rel);
CREATE INDEX IF NOT EXISTS idx_nv_node ON node_verse(node_id);
CREATE INDEX IF NOT EXISTS idx_nv_osis ON node_verse(osis);
CREATE INDEX IF NOT EXISTS idx_node_prov ON node(prov_class);
CREATE INDEX IF NOT EXISTS idx_node_kind ON node(kind);
CREATE INDEX IF NOT EXISTS idx_node_gc ON node(gc_class);
CREATE INDEX IF NOT EXISTS idx_node_canon ON node(canon_id);
CREATE INDEX IF NOT EXISTS idx_node_conf ON node(canon_confidence);
CREATE INDEX IF NOT EXISTS idx_closure_anc ON class_closure(ancestor);
CREATE INDEX IF NOT EXISTS idx_score_subj ON score(subject_id);
CREATE INDEX IF NOT EXISTS idx_score_dim ON score(dimension);
CREATE INDEX IF NOT EXISTS idx_xref_node ON xref(node_id);
CREATE INDEX IF NOT EXISTS idx_xref_sv ON xref(scheme, value);
CREATE INDEX IF NOT EXISTS idx_nsource_node ON node_source(node_id);
CREATE INDEX IF NOT EXISTS idx_form_node ON node_form(node_id);
CREATE INDEX IF NOT EXISTS idx_node_origin ON node(origin_source);
CREATE INDEX IF NOT EXISTS idx_verses_osis ON verses(osis);
CREATE INDEX IF NOT EXISTS idx_verses_leaf ON verses(leaf_index);
