#!/usr/bin/env bash
#
# set-impact-secrets.sh — mirror of agenticprimitives scripts/set-cloudflare-secrets.sh,
# adapted for impact's OWN workers (apps/impact-a2a + apps/impact-mcp).
#
# Generates + sets the production secrets the two Workers need. Secrets are generated
# internally and piped DIRECTLY to `wrangler secret put` — never written to a file or
# printed (except public addresses). Re-run is safe but overwrites existing values.
#
# Usage:
#   bash scripts/set-impact-secrets.sh                 # local-aes signer (fresh demo EOA)
#   A2A_KMS_BACKEND=gcp-kms bash scripts/set-impact-secrets.sh    # no-held-key signer (GCP KMS)
#   ENV=staging bash scripts/set-impact-secrets.sh     # alternate wrangler env
#
# Inputs (env):
#   ENV                       wrangler env (default: production)
#   BASE_SEPOLIA_RPC          RPC_URL for both workers (default: https://sepolia.base.org)
#   A2A_KMS_BACKEND           'gcp-kms' to use Cloud KMS (no held key); else local-aes
#   GCP_FILE                  GCP service-account JSON path (default: ~/content-signer-admin-sa.json)
#   A2A_CUSTODY_BRIDGE_SECRET if set, also stored on impact-a2a (social-custody bridge); set the
#                             SAME value on the Vercel impact app. Skipped (with a note) if unset.
#
# impact-a2a:  SESSION_JWT_SECRETS, CSRF_SECRET, A2A_SESSION_SECRET, RPC_URL,
#              (A2A_MASTER_PRIVATE_KEY | GCP_SERVICE_ACCOUNT_JSON), A2A_MAC_SECRET, [A2A_CUSTODY_BRIDGE_SECRET]
# impact-mcp:  RPC_URL, OAUTH_SIGNING_SECRET, A2A_MAC_SECRET (SAME value), [GCP_SERVICE_ACCOUNT_JSON]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV="${ENV:-production}"
A2A_DIR="$ROOT/apps/impact-a2a"
MCP_DIR="$ROOT/apps/impact-mcp"
BASE_SEPOLIA_RPC="${BASE_SEPOLIA_RPC:-https://sepolia.base.org}"
KMS_BACKEND_VALUE="${A2A_KMS_BACKEND:-local-aes}"
GCP_FILE="${GCP_FILE:-$HOME/content-signer-admin-sa.json}"

for cmd in openssl wrangler node; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "ERROR: missing required command: $cmd"; exit 1; }
done
wrangler whoami >/dev/null 2>&1 || { echo "ERROR: not logged into Cloudflare. Run: wrangler login"; exit 1; }

put() { # put <APP_DIR> <NAME>   (value on stdin)
  (cd "$1" && wrangler secret put "$2" --env "$ENV") >/dev/null
}

echo "Setting impact-a2a Worker secrets (env=$ENV)…"

# 1. SESSION_JWT_SECRETS ("kid:hex" expected by connect-auth.sessions)
KID="impact-$(date +%Y%m%d)"
printf '%s:%s' "$KID" "$(openssl rand -hex 32)" | put "$A2A_DIR" SESSION_JWT_SECRETS
echo "  ✓ SESSION_JWT_SECRETS  (kid=$KID)"

# 2. CSRF_SECRET / 3. A2A_SESSION_SECRET (0x hex64)
printf '0x%s' "$(openssl rand -hex 32)" | put "$A2A_DIR" CSRF_SECRET
echo "  ✓ CSRF_SECRET"
printf '0x%s' "$(openssl rand -hex 32)" | put "$A2A_DIR" A2A_SESSION_SECRET
echo "  ✓ A2A_SESSION_SECRET"

# 4. Signer backend.
if [ "$KMS_BACKEND_VALUE" = "gcp-kms" ]; then
  [ -f "$GCP_FILE" ] || { echo "ERROR: A2A_KMS_BACKEND=gcp-kms but $GCP_FILE not found."; exit 1; }
  node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(j.type!=="service_account"||!j.private_key||!j.client_email){throw new Error("not a GCP service-account JSON")}' "$GCP_FILE"
  cat "$GCP_FILE" | put "$A2A_DIR" GCP_SERVICE_ACCOUNT_JSON
  echo "  ✓ GCP_SERVICE_ACCOUNT_JSON  (impact-a2a, from $GCP_FILE) — set A2A_KMS_BACKEND=gcp-kms + GCP_KMS_KEY_NAME at deploy"
else
  # Fresh demo-only EOA. Generated + piped without ever landing in a printed var.
  WALLET_JSON="$(node -e '
    const {randomBytes}=require("crypto");
    const pk="0x"+randomBytes(32).toString("hex");
    process.stdout.write(JSON.stringify({private_key:pk}));
  ')"
  printf '%s' "$WALLET_JSON" | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0,"utf8")).private_key)' | put "$A2A_DIR" A2A_MASTER_PRIVATE_KEY
  unset WALLET_JSON
  echo "  ✓ A2A_MASTER_PRIVATE_KEY  (fresh local EOA — demo-only held key; prefer A2A_KMS_BACKEND=gcp-kms)"
fi

# 5. RPC_URL (impact-a2a)
printf '%s' "$BASE_SEPOLIA_RPC" | put "$A2A_DIR" RPC_URL
echo "  ✓ RPC_URL  (impact-a2a)"

# 6. A2A_MAC_SECRET — binds the a2a→mcp service envelope; the SAME value MUST be on both Workers.
MAC_SECRET="0x$(openssl rand -hex 32)"
printf '%s' "$MAC_SECRET" | put "$A2A_DIR" A2A_MAC_SECRET
echo "  ✓ A2A_MAC_SECRET  (impact-a2a)"

# 7. Optional social-custody bridge secret (must match the Vercel impact app's A2A_CUSTODY_BRIDGE_SECRET).
if [ -n "${A2A_CUSTODY_BRIDGE_SECRET:-}" ]; then
  printf '%s' "$A2A_CUSTODY_BRIDGE_SECRET" | put "$A2A_DIR" A2A_CUSTODY_BRIDGE_SECRET
  echo "  ✓ A2A_CUSTODY_BRIDGE_SECRET  (impact-a2a) — set the SAME value on the Vercel impact app"
else
  echo "  · A2A_CUSTODY_BRIDGE_SECRET not provided → Google/YouVersion KMS-custody sign-in stays disabled"
fi

echo ""
echo "Setting impact-mcp Worker secrets (env=$ENV)…"

# RPC_URL (impact-mcp)
printf '%s' "$BASE_SEPOLIA_RPC" | put "$MCP_DIR" RPC_URL
echo "  ✓ RPC_URL  (impact-mcp)"

# OAUTH_SIGNING_SECRET (demo OAuth ingress; never trusted as authority)
printf '%s' "${OAUTH_SIGNING_SECRET:-$(openssl rand -hex 32)}" | put "$MCP_DIR" OAUTH_SIGNING_SECRET
echo "  ✓ OAUTH_SIGNING_SECRET  (impact-mcp)"

# A2A_MAC_SECRET — SAME value as impact-a2a above.
printf '%s' "$MAC_SECRET" | put "$MCP_DIR" A2A_MAC_SECRET
echo "  ✓ A2A_MAC_SECRET  (impact-mcp, matches impact-a2a)"
unset MAC_SECRET

# GCP_SERVICE_ACCOUNT_JSON — impact-mcp's per-person vault KMS (spec 278) needs it regardless of
# the a2a signer backend. Set when the SA file is present.
if [ -f "$GCP_FILE" ]; then
  node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(j.type!=="service_account"||!j.private_key){throw new Error("not a GCP service-account JSON")}' "$GCP_FILE"
  cat "$GCP_FILE" | put "$MCP_DIR" GCP_SERVICE_ACCOUNT_JSON
  echo "  ✓ GCP_SERVICE_ACCOUNT_JSON  (impact-mcp vault KMS, from $GCP_FILE)"
else
  echo "  · GCP_SERVICE_ACCOUNT_JSON not set ($GCP_FILE missing) → vault read/write will fail closed"
fi

echo ""
echo "Done. Verify:"
echo "  cd apps/impact-a2a && wrangler secret list --env $ENV"
echo "  cd apps/impact-mcp && wrangler secret list --env $ENV"
echo "Then deploy:  pnpm deploy:impact"
