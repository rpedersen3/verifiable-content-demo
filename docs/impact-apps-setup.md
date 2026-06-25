# Impact apps — setup & configuration guide

How to create and configure the three **Impact** apps from a blank repository, on top of the
published `@agenticprimitives/*` packages. Written for anyone building a faith-vertical
"agent home" (or any vertical) the same way Impact does.

The three apps:

| App | Runtime | Role |
|-----|---------|------|
| **impact** | Next.js (Vercel) | The browser **home** + auth **broker**. Passkey/SIWE/social sign-in, mints `AgentSession` JWTs, proxies `/a2a/*` and `/mcp-bind/*` to the workers. |
| **impact-a2a** | Cloudflare Worker + Durable Objects | A2A boundary: SIWE/passkey verify, **relayer** (gasless Smart-Account deploys + UserOps), delegation-token minting, custody bridge. A byte-faithful copy of `agenticprimitives/apps/impact-a2a`. |
| **impact-mcp** | Cloudflare Worker + D1 | MCP server: delegation-verified tools, OAuth ingress, per-person **vault** (KMS-keyed). A byte-faithful copy of `agenticprimitives/apps/impact-mcp`. |

```
 browser ──▶ impact (Next.js/Vercel)
                │  /a2a/*  (server rewrite)      ┌─────────────┐
                ├───────────────────────────────▶│ impact-a2a  │── relayer / userOps ─▶ Base Sepolia
                │  /mcp-bind/*                    │  (Worker)   │── service binding ─▶ impact-mcp
                │                                 └─────────────┘
                └─────────────────────────────────▶ impact-mcp (Worker + D1 + vault)
```

All on-chain reads/writes target the **existing** `@agenticprimitives/contracts` deployment
(Base Sepolia) — you do **not** deploy contracts.

---

## 0. Prerequisites

- `node` ≥ 20, `pnpm` ≥ 9, `wrangler` ≥ 4 (`pnpm add -Dw wrangler`).
- A **Cloudflare** account (`wrangler login`).
- A **Vercel** project for the Next.js app (or any Next host) + a **Vercel KV / Upstash Redis** store.
- For the no-held-key signer path: a **GCP project** with **Cloud KMS** + a service-account JSON.
- The published `@agenticprimitives/*` packages on npm (this guide pins the `alpha.13` generation).

---

## 1. Repo + workspace

`pnpm-workspace.yaml`:

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

In the **root `package.json`**, pin the whole `@agenticprimitives` generation with
`pnpm.overrides` so every app resolves the same versions (peer deps are pinned **exactly**, so a
partial bump breaks — move the whole set together). The set that the impact apps compile against:

```jsonc
"pnpm": {
  "overrides": {
    "@agenticprimitives/a2a": "0.0.0-alpha.9",
    "@agenticprimitives/related-agents": "0.0.0-alpha.9",
    "@agenticprimitives/agent-account": "1.0.0-alpha.13",
    "@agenticprimitives/agent-naming": "1.0.0-alpha.13",
    "@agenticprimitives/audit": "1.0.0-alpha.13",
    "@agenticprimitives/connect": "1.0.0-alpha.13",
    "@agenticprimitives/connect-auth": "1.0.0-alpha.13",
    "@agenticprimitives/delegation": "1.0.0-alpha.13",
    "@agenticprimitives/key-custody": "1.0.0-alpha.13",
    "@agenticprimitives/mcp-runtime": "1.0.0-alpha.13",
    "@agenticprimitives/tool-policy": "1.0.0-alpha.13",
    "@agenticprimitives/types": "1.0.0-alpha.13",
    "@agenticprimitives/identity-directory": "1.0.0-alpha.13",
    "@agenticprimitives/identity-directory-adapters": "1.0.0-alpha.13",
    "@agenticprimitives/ontology": "1.0.0-alpha.13",
    "@agenticprimitives/contracts": "1.0.0-alpha.13",
    "@agenticprimitives/entitlements": "0.0.0-alpha.2",
    "@agenticprimitives/key-authorization": "0.0.0-alpha.3",
    "@agenticprimitives/mcp-oauth": "0.0.0-alpha.2",
    "@agenticprimitives/vault": "0.0.0-alpha.2"
  }
}
```

Also add `@agenticprimitives/contracts` (same version) to root `devDependencies` — the deploy
script imports the contract addresses from it. A shared `tsconfig.base.json` and each app's
`tsconfig.json` (`extends: ../../tsconfig.base.json`, `types: ["@cloudflare/workers-types", "node"]`)
complete the workspace.

> **Why this generation?** `agent-account@alpha.13` peers `types@alpha.13` + `connect-auth@alpha.13`
> (exact); `content-primitives@alpha.14` peers `types@alpha.13`; etc. Mixing generations fails to
> typecheck. Run `pnpm -r typecheck` after any bump.

---

## 2. Create impact-mcp (copy of impact-mcp)

Copy `agenticprimitives/apps/impact-mcp` → `apps/impact-mcp` (src + `migrations/` + `tsconfig.json`;
**skip** `node_modules`, `.wrangler`, `.dev.vars`, `*.db`). The `src/` stays identical; change only:

- **`package.json`**: `name` → `@<your-scope>/impact-mcp`; `workspace:*` deps → the published
  versions above; dev `--port`/`--persist-to` to unique values; D1 migrate scripts target `impact-mcp`.
- **`wrangler.toml`**:
  - `name = "impact-mcp"`
  - `[[d1_databases]]` and `[[env.production.d1_databases]]`: `database_name = "impact-mcp"`,
    `database_id` = the id you create in §4.
  - Keep `[env.production.vars]`: `CHAIN_ID="84532"`, `MCP_AUDIENCE="urn:mcp:server:person"`,
    `DEMO_OAUTH_MINT_ENABLED="true"`, `DEMO_VAULT_PROVISION_ENABLED="true"` (testnet demo only —
    omit the last two in a real production OP/AS setup).

---

## 3. Create impact-a2a (copy of impact-a2a)

Copy `agenticprimitives/apps/impact-a2a` → `apps/impact-a2a` (same exclusions). Change only:

- **`package.json`**: `name` → `@<your-scope>/impact-a2a`; deps → published versions; unique dev port.
- **`wrangler.toml`**:
  - `name = "impact-a2a"`
  - **Drop impact-a2a's `routes = ["*.<domain>/*"]`** unless you own that zone — the demo's route is
    already claimed by `impact-a2a-production`. impact reaches the worker via its `workers.dev` URL
    (the Next app's `/a2a/*` rewrite). Keep `workers_dev = true`.
  - `[[env.production.kv_namespaces]]` `BRIDGE_NONCES` + `FED_TOKENS`: ids from §4.
  - `[[env.production.services]]` `binding = "MCP"`, `service = "impact-mcp-production"`.
  - Signer + paymaster vars: see §5 (gcp-kms) and §7 (paymaster).

> The worker entrypoint reads contract addresses from **env vars** injected at deploy (§7), not from
> `config.ts`'s `readFileSync` (that's the local/anvil path; there's no FS on Workers).

---

## 4. Provision Cloudflare resources

```bash
wrangler login

# impact-a2a KV (in apps/impact-a2a)
wrangler kv namespace create impact-a2a-BRIDGE_NONCES   # → paste id into BRIDGE_NONCES
wrangler kv namespace create impact-a2a-FED_TOKENS      # → paste id into FED_TOKENS

# impact-mcp D1 (in apps/impact-mcp)
wrangler d1 create impact-mcp                           # → paste database_id into BOTH d1 blocks
wrangler d1 migrations apply impact-mcp --remote --env production
```

> Use **distinct** namespace titles (the demo's plain `BRIDGE_NONCES`/`FED_TOKENS` already exist on
> the account) so you don't share nonce/token state with another worker.

---

## 5. GCP KMS (no-held-key signer + envelope) — optional but recommended

The demo default (`A2A_KMS_BACKEND=local-aes`) stores a private key in the worker. To hold **no**
keys, use Cloud KMS for both the signer and the session envelope.

**Keys you need (project `<your-project>`, e.g. one keyring `agent-signers`):**

| Purpose | Algorithm | Used as |
|---|---|---|
| a2a relayer/master **signer** | `EC_SIGN_SECP256K1_SHA256` | `GCP_KMS_KEY_NAME` (a `cryptoKeyVersions/N` path) |
| session-data-key **envelope** | `GOOGLE_SYMMETRIC_ENCRYPTION` | `GCP_KMS_ENCRYPT_KEY_NAME` (a `cryptoKeys/<k>` path) |
| per-person **vault KEKs** (impact-mcp) | `GOOGLE_SYMMETRIC_ENCRYPTION`, one per person SA | resolved at runtime from each person's `VaultKeyBinding` |

The service account in `GCP_SERVICE_ACCOUNT_JSON` must have, on those keys:
`cloudkms.cryptoKeyVersions.useToSign` (signer), `...useToEncrypt`/`...useToDecrypt` (envelope + vault
KEKs), and — only if `DEMO_VAULT_PROVISION_ENABLED=true` — `cloudkms.cryptoKeys.create` on the
vault-KEK ring. Roles: `roles/cloudkms.signerVerifier` + `roles/cloudkms.cryptoKeyEncrypterDecrypter`
(+ `roles/cloudkms.admin` on the vault ring for on-demand provisioning).

**Find a key's path / its derived address** (gcloud-free — mint a token from the SA, call the KMS
REST API, derive the secp256k1 address from the public key). A KMS key is *never* exported to a
file; you reference it by path and it signs inside the HSM. The only file you need is the
**service-account JSON**. A reusable discovery snippet:

```js
// token: sign a JWT (RS256) with sa.private_key, exchange at sa.token_uri for scope cloudkms;
// then GET https://cloudkms.googleapis.com/v1/<keyVersion>/publicKey → PEM → SPKI DER →
// last 65 bytes (0x04‖X‖Y) → '0x' + keccak256(X‖Y).slice(-40) = the signer address.
```

`kms.manifest.json` (consumed by `pnpm kms:apply`) is the declarative source of truth for which
identity maps to which key/deploy target.

---

## 6. Secrets

Set per worker with `wrangler secret put <NAME> --env production` (run inside the app dir). The
repo's `scripts/set-impact-secrets.sh` (`pnpm secrets:impact`) generates + pipes them all,
including the **shared** `A2A_MAC_SECRET` on both workers.

**impact-a2a:**

| Secret | Notes |
|---|---|
| `SESSION_JWT_SECRETS` | `kid:hex64` — HS256 session signing |
| `CSRF_SECRET`, `A2A_SESSION_SECRET` | `0x`-hex64 |
| `RPC_URL` | Base Sepolia RPC (keyed provider recommended) |
| `A2A_MAC_SECRET` | binds the a2a→mcp service envelope — **same value on impact-mcp** |
| `A2A_MASTER_PRIVATE_KEY` | **local-aes only** (a held key — avoid in prod) |
| `GCP_SERVICE_ACCOUNT_JSON` | **gcp-kms only** — the SA JSON |
| `A2A_CUSTODY_BRIDGE_SECRET` | optional — social (Google/YouVersion) KMS-custody bridge; must match the Next app's value |

**impact-mcp:**

| Secret | Notes |
|---|---|
| `RPC_URL` | same RPC |
| `A2A_MAC_SECRET` | **same value** as impact-a2a |
| `OAUTH_SIGNING_SECRET` | demo OAuth ingress (never trusted as authority) |
| `GCP_SERVICE_ACCOUNT_JSON` | per-person vault KEKs |

```bash
# local-aes (held key, quickest):
pnpm secrets:impact
# no-held-key signer:
A2A_KMS_BACKEND=gcp-kms GCP_FILE=~/your-sa.json pnpm secrets:impact
```

---

## 7. Deploy the workers

Contract addresses are injected as `--var` from the published `@agenticprimitives/contracts`
deployment — `ENTRY_POINT`, `DELEGATION_MANAGER`, `AGENT_ACCOUNT_FACTORY`, the enforcers,
`UNIVERSAL_SIGNATURE_VALIDATOR`, `PAYMASTER` (=`smartAgentPaymaster`), naming registries, etc. The
repo's `scripts/deploy-impact-workers.ts` (`pnpm deploy:impact`) mirrors agenticprimitives'
`deploy-cloudflare.ts` (Workers only): preflight → D1 migrate → deploy **impact-mcp** → deploy
**impact-a2a** (with `MCP_URL` + `ALLOWED_ORIGINS` + broker vars) → write `impact-cloudflare-urls.json`.

```bash
# local-aes:
pnpm deploy:impact
# gcp-kms signer + envelope (recommended) — bake these into wrangler.toml so it's reproducible:
A2A_KMS_BACKEND=gcp-kms \
GCP_KMS_KEY_NAME=projects/<P>/locations/<L>/keyRings/<R>/cryptoKeys/<signer>/cryptoKeyVersions/1 \
GCP_KMS_ENCRYPT_KEY_NAME=projects/<P>/locations/<L>/keyRings/<R>/cryptoKeys/<envelope> \
PAYMASTER_VERIFYING_SIGNER=<signer-address> \
pnpm deploy:impact
```

**impact-a2a `[env.production.vars]` worth setting** (or pass via the deploy script env):
`ALLOWED_ORIGINS` (the home origins, CORS/CSRF), `A2A_PUBLIC_BASE_DOMAIN`, `BROKER_ISS` +
`BROKER_JWKS_URL` (the Next broker's origin + `/jwks`, for the social-custody gate), `DEMO_SSO_AUD`
(must equal the Next app's connect `aud`), and the signer block:
`A2A_KMS_BACKEND="gcp-kms"`, `GCP_KMS_KEY_NAME`, `GCP_KMS_ENCRYPT_KEY_NAME`,
`A2A_ALLOW_LOCAL_ENVELOPE_KEY="false"`, `PAYMASTER_VERIFYING_SIGNER` (your signer address).

**Paymaster / gasless deploys.** The Smart-Account deploy is sponsored by `smartAgentPaymaster`. If
the paymaster is **`devMode=true`** (testnet), it sponsors UserOps **without** checking a signer —
any signer works, no alignment needed. For a hardened deploy (devMode off) the on-chain
`verifyingSigner` must equal your a2a signer address; realigning it needs the paymaster `owner`.
Set `PAYMASTER_VERIFYING_SIGNER` to your signer's address so the appended envelope is self-consistent.

---

## 8. The impact Next.js app

Copy/author `apps/impact` (Next 15 / React 19). It is a **port of `agenticprimitives/apps/demo-sso-next`**
— the broker (`server/connect/*`, `server/_lib/*`, `app/connect/*`, `app/{jwks,me}`) + client
(`src/lib/connect.ts`, passkey/SIWE/social). It talks to the workers through two **server rewrites**
in `next.config.mjs`:

```js
const IMPACT_A2A_URL = process.env.IMPACT_A2A_URL || 'https://impact-a2a-production.<acct>.workers.dev';
const IMPACT_MCP_URL = process.env.IMPACT_MCP_URL || 'https://impact-mcp-production.<acct>.workers.dev';
// rewrites: '/a2a/:path*' → `${IMPACT_A2A_URL}/:path*`,  '/mcp-bind/:path*' → `${IMPACT_MCP_URL}/:path*`
// transpilePackages: the @agenticprimitives connect/auth/account/naming/identity-directory(+adapters) set
```

**Vercel environment variables:**

| Var | Required | Notes |
|---|---|---|
| `IMPACT_A2A_URL`, `IMPACT_MCP_URL` | recommended | override the workers.dev defaults |
| `BROKER_PRIVATE_JWK`, `BROKER_KID` | **yes** | the home mints `AgentSession` JWTs (ES256/P-256). Generate: `node apps/impact/scripts/gen-broker-key.mjs`. Mark the JWK **Sensitive**; only the public half is served at `/jwks`. |
| `KV_REST_API_URL` + `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL`/`_TOKEN`) | **yes (prod)** | single-use nonces + passkey challenges. Local dev falls back to a non-persistent in-memory store (one instance only). |
| `RPC_URL` | yes | Base Sepolia (keyed in prod) |
| `DEMO_SSO_AUD` | default `impact` | must equal the a2a `DEMO_SSO_AUD` |
| `ALLOWED_ISSUER_HOSTS` | optional | SEC-006 issuer-host allowlist; unset = accept the serving host (runs on any domain) |
| `GOOGLE_CLIENT_ID/SECRET`, `GOOGLE_REDIRECT_URI` | optional | Google OIDC (`…/oidc/google/callback`) |
| `YOUVERSION_CLIENT_ID`, `YOUVERSION_REDIRECT_URI` | optional | YouVersion OIDC (public PKCE client) |
| `A2A_CUSTODY_URL` (= `IMPACT_A2A_URL`) + `A2A_CUSTODY_BRIDGE_SECRET` | optional | needed for a **new social** identity to get a KMS-custodied home; the bridge secret must match impact-a2a's |

See `apps/impact/.env.example` for the canonical template.

---

## 9. Verify

```bash
pnpm -r typecheck                       # whole repo green

# workers (after deploy)
curl -s -o /dev/null -w "%{http_code}\n" https://impact-mcp-production.<acct>.workers.dev/health   # 200
curl -s -o /dev/null -w "%{http_code}\n" https://impact-a2a-production.<acct>.workers.dev/health   # 200
curl -s https://impact-a2a-production.<acct>.workers.dev/deployments        # contract registry (vars wired)
curl -s -X POST https://impact-a2a-production.<acct>.workers.dev/rpc \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'          # 0x14a34 (RPC secret wired)
curl -s -o /dev/null -w "%{http_code}\n" \
  https://impact-mcp-production.<acct>.workers.dev/.well-known/oauth-protected-resource   # 200
```

The full WebAuthn + on-chain deploy ceremony needs a real browser authenticator (not headless).

---

## Appendix — reference values from the live Impact deployment

Substitute your own account/project; these are the working values for the canonical deployment.

- Workers: `impact-a2a-production.richardpedersen3.workers.dev`, `impact-mcp-production.richardpedersen3.workers.dev`
- Cloudflare KV: `impact-a2a-BRIDGE_NONCES`, `impact-a2a-FED_TOKENS`; D1: `impact-mcp`
- GCP (`churchcore2`, `us-central1`):
  - signer `…/keyRings/agenticprimitives-demo/cryptoKeys/smart-agent-2/cryptoKeyVersions/1` → `0x3C7B58062f1c472f16eD843808fd95DA4697b702`
  - envelope `…/keyRings/agenticprimitives-demo/cryptoKeys/agent-envelope`
  - vault KEKs: `us-east1/vault-keks/<personSA>` (symmetric, one per person)
- `smartAgentPaymaster` `0x8eF92B9D62826052D8F7e6dcaB630dC3890bF540` is `devMode=true` (no signer check on testnet).

Helper scripts in this repo: `pnpm secrets:impact` (`scripts/set-impact-secrets.sh`),
`pnpm deploy:impact` (`scripts/deploy-impact-workers.ts`), `pnpm kms:apply` (`scripts/kms-apply.ts`).
