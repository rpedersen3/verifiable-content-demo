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

-- spec 277 §10 — owner-issued entitlement credentials (AgenticEntitlementCredentialV1) that authorize an
-- actor to read an owner's vault resource/fields. Loaded + matched (fail-closed) at vault_get time.
CREATE TABLE IF NOT EXISTS vault_entitlements (
  id          TEXT PRIMARY KEY,   -- urn:ap:entitlement:<uuid>
  principal   TEXT NOT NULL,      -- the data owner (credentialSubject.principal)
  actor       TEXT NOT NULL,      -- the holder/delegate (credentialSubject.id)
  resource    TEXT NOT NULL,
  credential  TEXT NOT NULL,      -- full JSON credential
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vault_ent_principal_actor ON vault_entitlements(principal, actor);

-- spec 277 §7 — OAuth grant bundles. A validated bearer token references a bundle by id+hash; the bundle
-- carries the principal/delegate + delegation/entitlement/policy hashes the delegated vault path runs off.
CREATE TABLE IF NOT EXISTS grant_bundles (
  id         TEXT PRIMARY KEY,   -- urn:ap:mcp-grant:<uuid>
  bundle     TEXT NOT NULL,      -- full JSON McpGrantBundleV1 (carries its own hash)
  created_at TEXT NOT NULL
);
