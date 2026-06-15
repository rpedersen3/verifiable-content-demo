-- x402 pay-per-use ledger (spec 272 consumer side). Applied to the demo-bible-bsb D1.

-- One row per on-chain settlement: a reader's agent wallet paid the lbsb treasury for an access.
CREATE TABLE IF NOT EXISTS payments_settled (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  edition TEXT NOT NULL,
  payer TEXT NOT NULL,            -- reader canonical agent id / SA
  payee TEXT NOT NULL,            -- lbsb treasury SA
  asset TEXT,                     -- fee token (USDC)
  amount TEXT,                    -- atomic units (string for wire-safety)
  reference TEXT,                 -- the scripture reference / resource paid for
  resource_hash TEXT,            -- canonicalized PaymentResource hash (anti-replay binding)
  mandate_id TEXT,
  nonce TEXT,
  settlement_hash TEXT,          -- on-chain settlement tx hash
  lane TEXT,                      -- grant | entitlement | settlement
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_settled_edition ON payments_settled(edition, id);
CREATE INDEX IF NOT EXISTS idx_settled_payer ON payments_settled(payer, edition);

-- Prepaid entitlements (the x402 'entitlement' lane): one settlement buys N reads (mintEntitlementOnPayment).
CREATE TABLE IF NOT EXISTS prepaid_entitlements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  edition TEXT NOT NULL,
  subject TEXT NOT NULL,          -- reader canonical agent id (binding='sa')
  record TEXT,                    -- the EntitlementRecord JSON (payments/entitlement)
  max_uses INTEGER NOT NULL DEFAULT 1,
  used INTEGER NOT NULL DEFAULT 0,
  valid_until TEXT,
  status TEXT NOT NULL DEFAULT 'active',  -- active | exhausted | revoked
  settlement_hash TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prepaid_subj ON prepaid_entitlements(subject, edition, status);

-- Subscriptions (spec 272 recurring lane): a reader authorizes ONCE a standing
-- person-treasury → lbsb-treasury PULL mandate (stored in the lbsb-treasury vault);
-- each billing period grants `reads_per_period` reads (a fresh prepaid pass). The
-- mandate's caveats (per-period cap, window, aggregate) bound every renewal on-chain.
-- Renewal that REDEEMS the mandate unattended needs the provider's signer (a held key)
-- and is intentionally left to an owner-authorized/owner-online step — see the A2A
-- /pay/subscription/renew stub. No-held-key renewal = the subscriber re-confirms (push).
CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  edition TEXT NOT NULL,
  subject TEXT NOT NULL,            -- reader canonical agent id (binding='sa')
  payer TEXT,                       -- person-treasury SA (delegator of the pull mandate)
  payee TEXT,                       -- lbsb-treasury SA (delegate / redeemer of the pull mandate)
  asset TEXT,                       -- fee token (USDC)
  tier TEXT NOT NULL,               -- tier id (basic | plus)
  tier_label TEXT,
  reads_per_period INTEGER NOT NULL,    -- per-period FAIR-USE CAP (abuse protection; not pay-per-read)
  period_uses INTEGER NOT NULL DEFAULT 0, -- reads used in the CURRENT period (resets on renewal)
  amount_per_period TEXT,           -- atomic units charged per period
  period_seconds INTEGER NOT NULL,  -- billing period length
  periods_authorized INTEGER,       -- # of periods the mandate's aggregate covers
  periods_charged INTEGER NOT NULL DEFAULT 1, -- periods billed so far (1 = first, at subscribe)
  current_period_start TEXT NOT NULL,
  current_period_end TEXT NOT NULL,     -- = next renewal time
  pull_mandate TEXT,                -- the stored person-treasury → lbsb-treasury PULL delegation (JSON)
  mandate_id TEXT,                  -- computeMandateId(pull mandate) — dedupe / on-chain ref
  status TEXT NOT NULL DEFAULT 'active', -- active | canceled | expired
  last_settlement_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sub_subj ON subscriptions(subject, edition, status);

-- Content-signer delegations (per-edition issuer trust): the owner-signed leaf binding an issuer SA
-- (e.g. lbsb.impact) to its Cloud-KMS content-signing key. Provisioned ONCE by the demo-corpus
-- "Authorize content signing" ceremony; loaded by the MCP resolveTrust(delegated) for signing + verify.
-- No private keys here — the KMS key never leaves Cloud KMS; this row holds the public authorization.
CREATE TABLE IF NOT EXISTS content_signers (
  issuer_name TEXT PRIMARY KEY,     -- e.g. 'lbsb.impact'
  issuer_sa TEXT NOT NULL,          -- the issuer Smart Agent address (0x91b4…)
  delegate_key TEXT NOT NULL,       -- the Cloud-KMS key's derived address (the authorized signer)
  delegation_leaf TEXT NOT NULL,    -- JSON of the signed delegation (issuer SA → delegate key)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
