-- spec 277 — the MCP delegated data vault (Phase 1: plaintext envelopes).
-- One row per (owner, resource); `envelope` is a JSON VaultObjectEnvelopeV1. Phase 2 (backlog B7)
-- swaps the plaintext payload for crypto refs (same on-disk shape). Soft-delete via deleted_at.
CREATE TABLE IF NOT EXISTS vault_objects (
  owner          TEXT NOT NULL,
  resource       TEXT NOT NULL,
  classification TEXT NOT NULL,
  envelope       TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted_at     TEXT,
  PRIMARY KEY (owner, resource)
);
CREATE INDEX IF NOT EXISTS idx_vault_owner ON vault_objects(owner);
