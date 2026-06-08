-- Bible ontology graph: DUL ⊃ PROV-O ⊃ {ORG, GeoSPARQL, aps:} ⊃ gc: (lower).
CREATE TABLE IF NOT EXISTS ontology_class (curie TEXT PRIMARY KEY, label TEXT, layer TEXT, parent TEXT, comment TEXT);
CREATE TABLE IF NOT EXISTS ontology_prop (curie TEXT PRIMARY KEY, label TEXT, layer TEXT, domain TEXT, range_ TEXT, inverse TEXT, comment TEXT);
CREATE TABLE IF NOT EXISTS node (
  id TEXT PRIMARY KEY, label TEXT, kind TEXT,
  prov_class TEXT, dul_class TEXT, org_class TEXT, geo_class TEXT, gc_class TEXT, aps_class TEXT,
  lat REAL, long REAL, wkt TEXT, t_start INTEGER, t_end INTEGER, meta TEXT
);
CREATE TABLE IF NOT EXISTS signal (id INTEGER PRIMARY KEY AUTOINCREMENT, subject_id TEXT, polarity TEXT, basis TEXT, osis TEXT);
CREATE TABLE IF NOT EXISTS edge (id INTEGER PRIMARY KEY AUTOINCREMENT, src TEXT, rel TEXT, dst TEXT, ctx TEXT);
CREATE TABLE IF NOT EXISTS node_verse (node_id TEXT, osis TEXT);
-- Real Global Church Ontology terms (pulled) for validation against PROV-O + Bible usage.
CREATE TABLE IF NOT EXISTS gco_term (curie TEXT PRIMARY KEY, label TEXT, type TEXT, parent TEXT, prov_align TEXT, comment TEXT);
CREATE INDEX IF NOT EXISTS idx_edge_src ON edge(src);
CREATE INDEX IF NOT EXISTS idx_edge_dst ON edge(dst);
CREATE INDEX IF NOT EXISTS idx_edge_rel ON edge(rel);
CREATE INDEX IF NOT EXISTS idx_nv_node ON node_verse(node_id);
CREATE INDEX IF NOT EXISTS idx_nv_osis ON node_verse(osis);
CREATE INDEX IF NOT EXISTS idx_node_prov ON node(prov_class);
CREATE INDEX IF NOT EXISTS idx_node_kind ON node(kind);
CREATE INDEX IF NOT EXISTS idx_node_gc ON node(gc_class);
