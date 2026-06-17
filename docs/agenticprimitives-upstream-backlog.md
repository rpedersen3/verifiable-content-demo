# agenticprimitives — upstream backlog (from verifiable-content-demo)

Changes the **`agenticprimitives`** monorepo needs, surfaced while migrating this repo onto the spec-276
KMS surface and prototyping the managed-KMS orchestrator (`ap-kms`). Ordered by priority. Each item:
what / why / where / how it showed up downstream.

Legend: 🔴 bug (breaks consumers) · 🟠 gap (blocks the managed-KMS goal) · 🟢 enhancement · 🔵 future phase.

---

## A. Publish-readiness bugs (found while installing alpha.10 here)

### A1. 🔴 `@agenticprimitives/delegated-signer@0.0.0-alpha.1` has stale exact peer pins
- **What:** its `peerDependencies` pin **exactly** `1.0.0-alpha.9` for `key-custody`, `types`, and
  `delegation` — but `resolveDelegatedSigner` needs the alpha.10 surface (`KmsAccountBackend` etc.). The
  package was published before the alpha.10 bump.
- **Why it matters:** any consumer on the current alpha.10 set gets peer-dependency conflicts. We only got
  past it because pnpm `overrides` force alpha.10 (pnpm warns, doesn't fail) — npm/yarn users would break.
- **Fix:** republish `delegated-signer` with peer ranges `^1.0.0-alpha.10` (or `>=` / workspace-aligned),
  and include it in the normal changeset/release so it tracks the rest of the set.

### A2. 🔴 `@agenticprimitives/delegation@1.0.0-alpha.10` ships extensionless ESM imports
- **What:** `delegation/dist/index.js` imports a sibling without a `.js` extension (observed:
  `Cannot find module '.../delegation/dist/types' imported from '.../delegation/dist/index.js'`).
- **Why it matters:** breaks **raw Node ESM** resolution. Bundlers (esbuild/wrangler) and `tsc`
  (`moduleResolution: bundler`) tolerate it, so Workers/Vercel/tsx work — but any plain-`node` consumer or
  test harness importing `delegation` (transitively via `delegated-signer`) throws. It cost real debugging
  time here.
- **Fix:** emit explicit `.js` extensions in the build (TS `moduleResolution: NodeNext` + extensioned
  relative imports, or a post-build extension rewrite). Audit the other packages for the same pattern.

---

## B. key-custody surface gaps (foundation for managed KMS)

### B1. 🟠 gcloud-free REST `StepExecutor` built into `provision-gcp`
- **What:** `ap-provision-gcp` / `executeGcpProvision` require **`gcloud` on PATH** (the CLI shells out).
- **Why:** consumers want a zero-dependency "drop the SA key and run" path (this repo's
  `provision-content-signer-keys.mjs` does exactly that via the Cloud KMS REST API + SA-JWT). Requiring
  gcloud is an operational regression.
- **Fix:** add a built-in REST `StepExecutor` (token via SA-JWT → KMS REST for keyring/key create, IAM
  setIamPolicy, getPublicKey). Keep the gcloud executor as an option. Reference impl: `scripts/kms/gcp.ts`
  in this repo.

### B2. 🟠 Accept dotted identity labels in `planGcpProvision`
- **What:** GCP cryptoKey ids allow `[a-zA-Z0-9_-]` only, so `provision-gcp` rejects identities like
  `fbsb.impact`; callers must pre-sanitize.
- **Why:** every real signing identity here is a dotted agent name. The downstream has to maintain its own
  `name → keyId` map and re-key the output.
- **Fix:** accept the dotted name as the identity, sanitize to a key id internally (`name.replace(/[^a-zA-Z0-9_-]/g,'-')`),
  and return the `ProvisionResult.keyMap` keyed by the **original** name.

### B3. 🟠 Per-key `roles/cloudkms.signerVerifier` option for the IAM grant
- **What:** `provision-gcp` grants `roles/cloudkms.signer`. Runtimes need `viewPublicKey` too (to derive the
  address / fetch the SPKI key); `signer` includes it, but the runbook here standardized on per-key
  `signerVerifier`.
- **Fix:** make the granted role configurable (default `signerVerifier`), still **per-key** (master-key
  separation).

### B4. 🟠 `GcpKmsSigner` should accept base64 / object SA like `parseServiceAccountJson`
- **What:** `parseServiceAccountJson` (kms-core) accepts single-line JSON **or base64**; `GcpKmsSigner`'s
  own SA parsing is stricter (raw JSON). So the same `GCP_SERVICE_ACCOUNT_JSON` secret can't be stored in
  one format that satisfies both the validator (kms-core) and the MCP (`GcpKmsSigner`).
- **Why:** we worked around it by writing canonical single-line JSON; base64 would be cleaner and dodges all
  literal-newline paste hazards (see B5).
- **Fix:** route `GcpKmsSigner`'s SA parsing through `parseServiceAccountJson`.

### B5. 🟢 Document/justify the strict SA parser (literal-newline hazard)
- **What:** `parseServiceAccountJson` does not tolerate literal newlines inside `private_key` (a common
  env-paste artifact). It bit the live validator when we dropped the old `parseLooseJson`.
- **Fix:** keep strict (good), but document that `GCP_SERVICE_ACCOUNT_JSON` must be single-line or base64,
  and have the orchestrator (B-tools) always write base64 so operators never paste raw multi-line.

### B6. 🟠 Deploy-target secret-writers (Cloudflare + Vercel) — new module, NOT in key-custody
- **What:** nothing in the monorepo writes secrets to a deploy target; it's all manual `wrangler secret put`
  / Vercel dashboard.
- **Why:** the managed-KMS goal ("system writes the runtime config") needs programmatic, no-echo writers.
- **Fix:** a small `deploy`-oriented tool/package:
  - **Cloudflare:** pipe into `wrangler secret put` (or CF API with `CLOUDFLARE_API_TOKEN`).
  - **Vercel:** **REST API** (`/v10/projects/{id}/env`, `type:"encrypted"`). ⚠ `vercel env add` from stdin
    **stores an empty value** (observed) — do not use it; use the API. Resolve project id + team via the API.
  - Placement: a sibling tool (e.g. `@agenticprimitives/deploy-secrets` or a `tools/` CLI), **not**
    `key-custody` (key-custody must stay a dependency-light custody leaf, ADR-0021).
  - Reference impl: `scripts/kms/targets.ts` in this repo.

---

## C. The `ap-kms` orchestrator (lift this repo's prototype upstream)

### C1. 🟠 `ap-kms` CLI + manifest schema
- **What:** a manifest-driven orchestrator that runs the whole flow: provision → per-key IAM → derive +
  verify EVM address → resolve name→SA → (report the ceremony gap) → write runtime secrets to each target →
  `--verify` binding-drift. Modes: default report / `--write` / `--dry-run` / `--verify`.
- **Reference impl (working, validated on live CF + Vercel):** `scripts/kms/{manifest,gcp,targets,apply}.ts`
  + `kms.manifest.json` + `pnpm kms:apply` in this repo. Flow doc: `docs/kms-agent-configuration-flow.md`.
- **Design constraints when upstreaming:**
  - **Inject the name→SA resolver** (and account/ERC-1271 checks) rather than importing `agent-naming` /
    `agent-account` into the tool's core — keep the reusable core a leaf (ADR-0021). The CLI wires the
    real clients.
  - Identity model = `{ name, targets[] }` (one key fans out to multiple deploy targets — e.g. the validator
    key also lives in the MCP's key map for the ceremony/address lookup).
  - Idempotent, fail-closed, never echo secrets; the owner-signed delegation leaf is the one human step the
    tool reports but never fabricates.

### C2. 🟢 `--verify` as a first-class managed-KMS health check
- Per identity: resolve name→SA, derive the **live** KMS delegate, compare to the **owner-authorized**
  delegate + SA stored in the bindings source (here: MCP `content_signers`); non-zero exit on drift. Already
  prototyped here.

---

## D. Home / ceremony (apps/demo-sso-next)

### D1. 🟢 Content-signer ceremony should accept any declared signing identity
- **What:** the SA→KMS-delegate authorization leaf is produced by the home content-signer ceremony
  (`issueSessionDelegation`/`buildSessionDelegation`, `authority: ROOT_AUTHORITY`). Adding a new KMS-backed
  agent depends on the home being able to run the ceremony for that identity.
- **Fix:** confirm the ceremony admits an arbitrary `content_signer_target` (the orchestrator passes the
  identity + delegate address); make "authorize a new signing identity" a first-class, repeatable flow so
  the only manual step for a new agent stays a single signature.

---

## E. Keyless / Workload Identity Federation (future phase)

### E1. 🔵 Federated-token KMS transport in `/kms-core` (no SA JSON at runtime)
- **What:** today every runtime holds a `GCP_SERVICE_ACCOUNT_JSON`. The end-state is **no JSON key**: the
  Worker/Vercel function authenticates to Cloud KMS via **Workload Identity Federation** / OIDC token
  exchange / SA impersonation.
- **Fix:** add a `createGcpKmsTransport` variant that accepts an **async access-token provider** (instead of
  a static `ServiceAccount`), plus docs for the GCP workload-identity-pool setup that trusts each platform's
  OIDC token. This removes B4/B5 entirely for production.

---

## Suggested sequencing
1. **A1, A2** — publish-readiness bugs (small, unblock clean installs everywhere).
2. **B1–B4 + B6** — provision REST executor, dotted labels, signerVerifier, `GcpKmsSigner` base64, and the
   deploy-secret writers (the foundation).
3. **C1, C2** — lift `ap-kms` (+ `--verify`) onto that foundation; changeset + release.
4. **D1** — make the ceremony a repeatable per-identity flow.
5. **E1** — keyless WIF transport (drops the SA-JSON bridge).
