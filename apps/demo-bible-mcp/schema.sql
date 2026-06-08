-- D1 schema for the full BSB corpus (durable; the Worker rebuilds nothing on reboot).
CREATE TABLE IF NOT EXISTS corpus (
  edition     TEXT PRIMARY KEY,
  version     TEXT,
  corpus_ref  TEXT,
  corpus_root TEXT,
  leaf_count  INTEGER,
  issuer      TEXT
);
CREATE TABLE IF NOT EXISTS verses (
  edition      TEXT,
  canonical_id TEXT,
  osis         TEXT,
  leaf_index   INTEGER,
  commitment   TEXT,
  text         TEXT,
  PRIMARY KEY (edition, canonical_id)
);
CREATE INDEX IF NOT EXISTS idx_verses_leaf ON verses(edition, leaf_index);
