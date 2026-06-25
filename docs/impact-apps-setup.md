# Building an Impact-style agent home — full setup & deployment guide

How to stand up the three apps from a **blank repo**, on the published `@agenticprimitives/*`
packages. This is the generalized version of the live **Impact** deployment (home `churchcore.me`,
workers `impact-a2a` / `impact-mcp`). Substitute your own names everywhere — see
[Naming](#naming-pick-these-first).

| App | Runtime | Role |
|-----|---------|------|
| **`<home>`** (Impact) | Next.js (Vercel) | Browser **home** + auth **broker**: passkey/SIWE/social sign-in, mints `AgentSession` JWTs, proxies `/a2a/*` + `/mcp-bind/*` to the workers. |
| **`<home>-a2a`** (impact-a2a) | Cloudflare Worker + Durable Objects | A2A boundary: SIWE/passkey verify, **relayer** (gasless Smart-Account deploys + UserOps), delegation-token minting, social-custody bridge. Template: **`apps/impact-a2a`** (this repo). |
| **`<home>-mcp`** (impact-mcp) | Cloudflare Worker + D1 | MCP server: delegation-verified tools, OAuth ingress, per-person KMS **vault**. Template: **`apps/impact-mcp`** (this repo). |

> This guide uses **this repo's `impact` / `impact-a2a` / `impact-mcp` apps as the template** for a new
> repo. The only thing pulled from **agenticprimitives** is the published **`@agenticprimitives/*`
> packages** (npm) — you do not copy or depend on its `demo-*` apps.

```
 browser ─▶ <home> (Next.js / Vercel)
              │  /a2a/*  (server rewrite)        ┌──────────┐
              ├─────────────────────────────────▶│ <home>-a2a│─ relayer/userOps ─▶ Base Sepolia
              │  /mcp-bind/*                      │ (Worker)  │─ service binding ─▶ <home>-mcp
              └───────────────────────────────────▶ <home>-mcp (Worker + D1 + vault)
```

On-chain reads/writes target the **existing** `@agenticprimitives/contracts` deployment (Base
Sepolia). **You do not deploy contracts.**

---

## Naming (pick these first)

You will substitute three things throughout:

| Placeholder | Live Impact value | What it is |
|---|---|---|
| `<home>` | `impact` | your app/worker base name |
| `<domain>` | `churchcore.me` | the registrable home domain (served on `www.<domain>`) |
| `<gcp-project>` | `churchcore2` | your Google Cloud project id |

When you copy this repo's `impact-a2a`/`impact-mcp`, rename **`impact-a2a`→`<home>-a2a`**,
**`impact-mcp`→`<home>-mcp`**, and **`churchcore.me`→`<domain>`** across src/configs. This is safe
**except** verify these stay internally consistent (they're not cross-system, so a uniform rename is
fine): the vault server id (`VAULT_SERVER_ID`, `vaultId`, `serverId` — only rename on a **fresh**
vault, before any encrypted rows exist), the delegation-token `iss`, and health/`served_by` labels.
The a2a↔mcp service-MAC binds `service: 'a2a-to-mcp'` + `MCP_AUDIENCE` (do **not** touch). Run
`pnpm -r typecheck` after.

---

## 0. Prerequisites

- `node` ≥ 20, `pnpm` ≥ 9, `wrangler` ≥ 4. `wrangler login`.
- A **Cloudflare** account and a **Vercel** project (+ a **Vercel KV / Upstash Redis** store).
- A **Google Cloud** project for KMS (no-held-key signer) and OAuth (social sign-in).
- `openssl` + `node` for the secrets script.

---

## 1. Workspace + version pinning

`pnpm-workspace.yaml`:
```yaml
packages: ['apps/*', 'packages/*']
```

The `@agenticprimitives` packages pin **exact** peer versions, so move the whole generation together
in root `package.json` `pnpm.overrides` (the set the apps compile against):

```jsonc
"pnpm": { "overrides": {
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
}}
```
Also add `@agenticprimitives/contracts@1.0.0-alpha.13` to root `devDependencies` (the deploy script
imports addresses from it). Each app `tsconfig.json` extends a shared `tsconfig.base.json` with
`types: ["@cloudflare/workers-types", "node"]`.

---

## 2. Copy + rename the two workers

Copy this repo's `apps/impact-mcp` → `apps/<home>-mcp` and `apps/impact-a2a` → `apps/<home>-a2a`
(src + `migrations/` + `tsconfig.json`; **exclude** `node_modules`, `.wrangler`, `.dev.vars`, `dist`,
`*.db`). Then:

**`<home>-mcp`** — `package.json` name → `@<scope>/<home>-mcp`, deps `workspace:*` → the pinned
versions, unique dev port/persist-to, D1 scripts target `<home>-mcp`. `wrangler.toml`:
`name = "<home>-mcp"`, both `[[d1_databases]]` blocks `database_name = "<home>-mcp"` + the id from §3,
keep `[env.production.vars]` (`CHAIN_ID="84532"`, `MCP_AUDIENCE="urn:mcp:server:person"`,
`DEMO_OAUTH_MINT_ENABLED="true"`, `DEMO_VAULT_PROVISION_ENABLED="true"` — testnet-only).

**`<home>-a2a`** — same package rename. `wrangler.toml`: `name = "<home>-a2a"`; **keep it route-less**
(`impact-a2a` has no custom `routes` — you reach the worker via its `workers.dev` URL through the Next
`/a2a/*` rewrite; keep `workers_dev = true`); `[[env.production.kv_namespaces]]` `BRIDGE_NONCES` +
`FED_TOKENS` ids from §3; `[[env.production.services]]` `binding = "MCP"`,
`service = "<home>-mcp-production"`.

> The worker reads contract addresses from **env vars** injected at deploy (§6) — `config.ts`'s
> `readFileSync` is the local/anvil path only (Workers have no FS).

---

## 3. Cloudflare resources

```bash
wrangler login
# <home>-a2a KV (run in apps/<home>-a2a) — use DISTINCT per-deployment titles (don't reuse another worker's):
wrangler kv namespace create <home>-a2a-BRIDGE_NONCES   # → paste id into BRIDGE_NONCES
wrangler kv namespace create <home>-a2a-FED_TOKENS      # → paste id into FED_TOKENS
# <home>-mcp D1 (run in apps/<home>-mcp):
wrangler d1 create <home>-mcp                           # → paste database_id into BOTH d1 blocks
wrangler d1 migrations apply <home>-mcp --remote --env production
```

---

## 4. Google Cloud — KMS / HSM (no-held-key signer + envelope + vault keys)

The demo default `A2A_KMS_BACKEND=local-aes` stores a private key in the worker. To hold **no keys**,
use Cloud KMS. **Console path:** Google Cloud Console → **Security → Key Management** (search "KMS";
service is `cloudkms.googleapis.com` — enable it if prompted).

### 4.1 Create a key ring + keys

**Key Management → Create key ring** (e.g. name `agent-signers`, a region like `us-central1` — note
it; keys are regional). Then **Create key** for each:

| Key | Create-key settings | Used as |
|---|---|---|
| **signer** (e.g. `a2a-master`) | Purpose **Asymmetric sign**; Algorithm **Elliptic Curve secp256k1 - SHA256** (`EC_SIGN_SECP256K1_SHA256`); Protection level **HSM** (or Software) | `GCP_KMS_KEY_NAME` — the **version** path `…/cryptoKeys/a2a-master/cryptoKeyVersions/1` |
| **envelope** (e.g. `agent-envelope`) | Purpose **Symmetric encrypt/decrypt** | `GCP_KMS_ENCRYPT_KEY_NAME` — the **key** path `…/cryptoKeys/agent-envelope` (no version) |
| **vault KEKs** (per-person) | Purpose **Symmetric encrypt/decrypt**; created **on demand** by `<home>-mcp` when `DEMO_VAULT_PROVISION_ENABLED=true`, named by person-SA address, in a `vault-keks` ring | resolved per-person at runtime from each `VaultKeyBinding` |

> A KMS/HSM key is **never exported to a file** — you reference it by resource path and it signs
> inside the HSM. The signer's Ethereum address is *derived* from its public key (§4.3).

### 4.2 Service account + IAM

**IAM & Admin → Service Accounts → Create service account** (e.g. `agent-signer`). **Create key →
JSON** and download — this JSON is your **`GCP_SERVICE_ACCOUNT_JSON`** secret (the only Google file
you need). Grant it, on the key ring (Key Management → ring → **Permissions**, or IAM):

- `roles/cloudkms.signerVerifier` — sign with the secp256k1 key
- `roles/cloudkms.cryptoKeyEncrypterDecrypter` — envelope + vault KEK encrypt/decrypt
- `roles/cloudkms.admin` on the **vault-keks** ring **only if** `DEMO_VAULT_PROVISION_ENABLED=true`
  (the app creates a KEK per owner on demand)

### 4.3 Find a key's path + derived address (gcloud-free)

You don't need `gcloud`. Mint a token from the SA and call the KMS REST API:

```js
// 1) JWT-bearer token: sign {iss:sa.client_email, scope:'https://www.googleapis.com/auth/cloudkms',
//    aud:sa.token_uri, iat, exp} as RS256 with sa.private_key → POST sa.token_uri
//    (grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=<jwt>) → access_token.
// 2) List:  GET https://cloudkms.googleapis.com/v1/projects/<P>/locations/<L>/keyRings
//           …/<ring>/cryptoKeys     …/<key>/cryptoKeyVersions?filter=state=ENABLED
// 3) Address of a secp256k1 key version:
//    GET …/<version>/publicKey → pem → SPKI DER → last 65 bytes (0x04‖X‖Y) →
//    '0x' + keccak256(X‖Y).slice(-40)
// 4) Permission probe: POST …/<version>:asymmetricSign {digest:{sha256:<b64>}} → expect a signature.
//    Envelope key:    POST …/<key>:encrypt {plaintext:<b64>} then :decrypt → round-trip.
```

The signer **address** is what you put in `PAYMASTER_VERIFYING_SIGNER` (§6).

---

## 5. Google Cloud — OIDC (Google sign-in)

**Console path:** APIs & Services → **OAuth consent screen** (configure once: User type, app name,
support email, your domain), then **Credentials → Create credentials → OAuth client ID → Web
application**.

- **Authorized JavaScript origins:** `https://www.<domain>` (and `https://<domain>` if you serve the
  apex).
- **Authorized redirect URIs (EXACT match, no trailing slash):** `https://www.<domain>/oidc/google/callback`
  — one per origin you sign in on. (YouVersion: register `…/oidc/youversion/callback`.)

Copy the **Client ID** + **Client secret** → the three Vercel env vars in §7.

> **Gotchas we hit:** (1) `redirect_uri_mismatch` = the URI isn't registered **verbatim** for that
> client — changes can take minutes to propagate. (2) The bare **apex** (`<domain>` without `www`)
> doesn't send a redirect — make the apex **301 → `www`**, or apex visitors fail. (3) Reusing an
> existing OAuth client is fine; just **add** your callback to its redirect URIs.

Full checklist: `apps/<home>/OIDC-SETUP.md`.

---

## 6. Secrets + deploy

Set secrets with `wrangler secret put <NAME> --env production` (inside each app dir);
`scripts/set-<home>-secrets.sh` automates it and sets the **shared** `A2A_MAC_SECRET` on both.

**`<home>-a2a`:** `SESSION_JWT_SECRETS` (`kid:hex64`), `CSRF_SECRET`, `A2A_SESSION_SECRET`
(`0x`-hex64), `RPC_URL`, `A2A_MAC_SECRET` (same on mcp), `GCP_SERVICE_ACCOUNT_JSON` (gcp-kms),
**`A2A_MASTER_PRIVATE_KEY`** and, for social sign-in, **`A2A_CUSTODY_BRIDGE_SECRET`** (see §8).
**`<home>-mcp`:** `RPC_URL`, `A2A_MAC_SECRET` (same value), `OAUTH_SIGNING_SECRET`,
`GCP_SERVICE_ACCOUNT_JSON`.

> **Non-obvious:** `A2A_MASTER_PRIVATE_KEY` is required **even in gcp-kms mode** — the social-custody
> bridge derives each subject's custodian by HKDF from it (the KMS key signs userOps; the master
> secret seeds per-subject custodians). It is *not* used for signing when `A2A_KMS_BACKEND=gcp-kms`.

Deploy (contract addresses injected as `--var` from `@agenticprimitives/contracts`):
```bash
# gcp-kms (recommended). Bake these into <home>-a2a/wrangler.toml so a plain deploy reproduces them.
A2A_KMS_BACKEND=gcp-kms \
GCP_KMS_KEY_NAME=projects/<P>/locations/<L>/keyRings/<ring>/cryptoKeys/<signer>/cryptoKeyVersions/1 \
GCP_KMS_ENCRYPT_KEY_NAME=projects/<P>/locations/<L>/keyRings/<ring>/cryptoKeys/<envelope> \
PAYMASTER_VERIFYING_SIGNER=<signer-address-from-4.3> \
IMPACT_BROKER_ORIGIN=https://www.<domain> \
pnpm deploy:<home>      # deploys <home>-mcp then <home>-a2a; writes <home>-cloudflare-urls.json
```
Also set `A2A_ALLOW_LOCAL_ENVELOPE_KEY="false"` in `wrangler.toml` once the KMS envelope key is set.

**Paymaster / gasless deploys.** Smart-Account deploys are sponsored by `smartAgentPaymaster`. On the
shared testnet it is **`devMode=true`** (`verifyingSigner` unset) → it sponsors UserOps **without** a
signer-match, so any signer works and **no realignment is needed**. For a hardened deploy (devMode
off) the on-chain `verifyingSigner` must equal your signer address (`PAYMASTER_VERIFYING_SIGNER`) —
realigning it needs the paymaster `owner`.

---

## 7. The Next.js home (Vercel)

Template: this repo's `apps/impact` (the broker + passkey/SIWE/social client). Two
server rewrites in `next.config.mjs`:
```js
const IMPACT_A2A_URL = process.env.IMPACT_A2A_URL || 'https://<home>-a2a-production.<acct>.workers.dev';
const IMPACT_MCP_URL = process.env.IMPACT_MCP_URL || 'https://<home>-mcp-production.<acct>.workers.dev';
// rewrites: '/a2a/:path*' → `${IMPACT_A2A_URL}/:path*`,  '/mcp-bind/:path*' → `${IMPACT_MCP_URL}/:path*`
```

**Vercel env (Production):**

| Var | Req | Notes |
|---|---|---|
| `IMPACT_A2A_URL`, `IMPACT_MCP_URL` | rec | override the workers.dev defaults |
| `BROKER_PRIVATE_JWK`, `BROKER_KID` | **yes** | home mints `AgentSession` JWTs (ES256). Generate: `node apps/<home>/scripts/gen-broker-key.mjs`. JWK is **Sensitive**; only the public half serves at `/jwks`. |
| `KV_REST_API_URL` + `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL`/`_TOKEN`) | **yes** | OIDC `state` + nonces span isolates → must be real KV, not in-memory. |
| `RPC_URL` | yes | Base Sepolia (keyed in prod) |
| `DEMO_SSO_AUD` | dflt `impact` | must equal `<home>-a2a`'s `DEMO_SSO_AUD` |
| `ALLOWED_ISSUER_HOSTS` | opt | unset = accept the serving host (runs on any domain) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`(**sensitive**), `GOOGLE_REDIRECT_URI` | for Google | `…/oidc/google/callback` exact-match (§5) |
| `YOUVERSION_CLIENT_ID`, `YOUVERSION_REDIRECT_URI` | for YV | YouVersion redirect auto-derives from host |
| `A2A_CUSTODY_URL` (=`IMPACT_A2A_URL`), `A2A_CUSTODY_BRIDGE_SECRET` | for social homes | §8 |

`apps/<home>/.env.example` is the canonical template. Single-home apps hardcode the domain in
`src/lib/domain.ts` (`CONNECT_DOMAIN`) + `server/_lib/origin.ts` issuer-host defaults; the app also
resolves the domain dynamically from the live host, so it runs anywhere.

---

## 8. Social-custody bridge (new Google/YouVersion homes)

A social identity that **verifies but has no home** needs `<home>-a2a` to mint a KMS-custodied Smart
Agent (else the callback returns `?connect_status=bootstrap`). The broker (Next) calls
`<home>-a2a` `/custody/google/resolve`, HMAC-signed with a **shared secret**:

1. Generate one secret; set it on **both** sides (same value):
   `wrangler secret put A2A_CUSTODY_BRIDGE_SECRET --env production` (in `apps/<home>-a2a`) **and** on
   the Vercel project.
2. `A2A_CUSTODY_URL` defaults to `IMPACT_A2A_URL`; `DEMO_SSO_AUD` must match on both.
3. **`BROKER_ISS`** on `<home>-a2a` must equal the home origin (`https://www.<domain>`) — the
   `bootstrap-and-claim`/`sign` gate verifies broker-minted sessions against it. **One `<home>-a2a`
   custody-gates exactly one issuer** — if you run multiple home domains off one worker, only one can
   be the custody issuer (deploy a worker per home otherwise).
4. `A2A_MASTER_PRIVATE_KEY` must be set (HKDF custodian derivation, §6).

Verify configured (a valid call needs the HMAC, so unsigned → **401**, not 503):
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  https://<home>-a2a-production.<acct>.workers.dev/custody/google/resolve \
  -H 'content-type: application/json' -d '{"iss":"x","sub":"y"}'      # 401 = configured
```

---

## 9. Verify

```bash
pnpm -r typecheck
M=https://<home>-mcp-production.<acct>.workers.dev
A=https://<home>-a2a-production.<acct>.workers.dev
curl -s -o /dev/null -w "%{http_code}\n" $M/health                      # 200
curl -s -o /dev/null -w "%{http_code}\n" $A/health                      # 200
curl -s $A/deployments                                                  # contract registry (vars wired)
curl -s -X POST $A/rpc -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'      # 0x14a34 (RPC secret wired)
curl -s -o /dev/null -w "%{http_code}\n" $M/.well-known/oauth-protected-resource   # 200
```
The full WebAuthn + on-chain deploy ceremony needs a real browser authenticator (not headless).

---

## Appendix — live Impact reference values

Substitute your own; these are the canonical deployment.

- Domain `churchcore.me` (served on `www.churchcore.me`); workers
  `impact-{a2a,mcp}-production.richardpedersen3.workers.dev`.
- Cloudflare KV `impact-a2a-BRIDGE_NONCES` / `impact-a2a-FED_TOKENS`; D1 `impact-mcp`.
- GCP project `churchcore2`, `us-central1`:
  - signer `…/keyRings/agenticprimitives-demo/cryptoKeys/smart-agent-2/cryptoKeyVersions/1`
    → `0x3C7B58062f1c472f16eD843808fd95DA4697b702`
  - envelope `…/keyRings/agenticprimitives-demo/cryptoKeys/agent-envelope`
  - per-person vault KEKs in `us-east1/vault-keks/<personSA>` (symmetric)
  - SA `agenticprimitives-signer@churchcore2.iam.gserviceaccount.com`
- Google OAuth client `960572345946-shkoae….apps.googleusercontent.com`; redirect
  `https://www.churchcore.me/oidc/google/callback`.
- `smartAgentPaymaster` `0x8eF92B9D62826052D8F7e6dcaB630dC3890bF540` is `devMode=true` (no signer
  check on testnet).

Helper scripts: `pnpm secrets:impact` (`scripts/set-impact-secrets.sh`), `pnpm deploy:impact`
(`scripts/deploy-impact-workers.ts`), `pnpm kms:apply` (`scripts/kms-apply.ts`). See also
`apps/impact/OIDC-SETUP.md`.
