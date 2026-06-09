-- Entitlement + corpus-ownership operational tables (D1 demo-bible-bsb).
-- Canonical inputs per CLAUDE.md: this DDL is committed; .data is regenerated.
-- The CANONICAL held entitlement is the VC in the reader's demo-mcp vault; the
-- entitlements_issued row here is the issuer's revocation + audit ledger only.

CREATE TABLE IF NOT EXISTS service_identity (
  service          TEXT PRIMARY KEY,         -- 'bsb-archive' | 'scripture-agent'
  issuer_agent_id  TEXT NOT NULL,            -- canonical agent id of the claimed agent (bsb.impact)
  owner_sub        TEXT NOT NULL,            -- OIDC sub that claimed it (the owner)
  delegate_address TEXT NOT NULL,            -- 0xKMS (the operational delegate key)
  delegation       TEXT NOT NULL,            -- the owner->delegate delegation wire (verified at MCP load)
  scoped_signer_tx TEXT,                     -- on-chain ERC-1271 scoped-signer registration (optional)
  created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entitlement_requests (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  subject          TEXT NOT NULL,            -- reader canonical agent id (from verified id_token; never typed)
  subject_name     TEXT,
  edition          TEXT NOT NULL,
  note             TEXT,
  status           TEXT NOT NULL DEFAULT 'pending',  -- pending | granted | denied
  reader_delegation TEXT,                    -- captured at request time -> deliver the VC right away
  created_at       TEXT NOT NULL,
  decided_at       TEXT,
  decided_by_sub   TEXT
);
CREATE INDEX IF NOT EXISTS ix_entreq_subject ON entitlement_requests(subject, status);
CREATE INDEX IF NOT EXISTS ix_entreq_status  ON entitlement_requests(status, id);

CREATE TABLE IF NOT EXISTS entitlements_issued (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id       INTEGER,
  edition          TEXT NOT NULL,
  subject          TEXT NOT NULL,            -- == entitlement.credentialSubject.id
  issued_by_sub    TEXT,                     -- owner sub that approved
  entitlement      TEXT NOT NULL,            -- the signed Entitlement VC (audit copy)
  valid_until      TEXT,
  status           TEXT NOT NULL DEFAULT 'granted',  -- granted | revoked
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_entiss_subject ON entitlements_issued(subject, edition, status);
