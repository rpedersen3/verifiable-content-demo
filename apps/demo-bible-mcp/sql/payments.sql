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
