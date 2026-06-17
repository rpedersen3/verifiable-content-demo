# Spec: Managed KMS configuration (provision → bind → wire), Cloudflare + Vercel

Status: **proposed / design** (grounded inventory done 2026-06-16)
Related: spec 266 (delegated content trust), spec 276 (KMS consumer surface), [[validator-kms-signing-live]], [[spec-276-kms-consumer-surface-migration]]

## Goal

Once the smart agents are configured, the system manages **every** step to get Cloud-KMS signing
working for an app — provision the HSM key, grant IAM, derive the address, bind the key to the agent
SA, and write the minimal runtime secrets to the right deploy target. Adding a new KMS-backed app =
one manifest entry + one command. No raw service-account JSON pasted into terminals. Fail closed.

## Current state (inventory)

KMS consumers and their config conventions differ per app:

| App | Target | Provision | Runtime KMS config | SA↔key binding |
|-----|--------|-----------|--------------------|----------------|
| demo-bible-mcp | Cloudflare | `scripts/provision-content-signer-keys.mjs` (REST, gcloud-free) | `CONTENT_SIGNER_KEYS` (name→keyVersion map) + `GCP_SERVICE_ACCOUNT_JSON` | D1 `content_signers` leaf (ceremony) |
| demo-validator | Vercel | same script | `VALIDATOR_KMS_KEY` + `VALIDATOR_DELEGATION_LEAF` + `VALIDATOR_SA` + `GCP_SERVICE_ACCOUNT_JSON` | env leaf |
| demo-a2a (monorepo) | Cloudflare | manual | `GCP_KMS_KEY_NAME` + `GCP_KMS_ENCRYPT_KEY_NAME` + `GCP_SERVICE_ACCOUNT_JSON` | per-subject HKDF (spec 235) |

Package surface (`@agenticprimitives/key-custody`): `/kms-core` (peer-free signing), `/provision-gcp`
(`planGcpProvision`/`executeGcpProvision` + `ap-provision-gcp` CLI), `GcpKmsSigner`. Gaps:
- `ap-provision-gcp` **requires gcloud on PATH**; only accepts sanitized identity labels (dotted
  `fbsb.impact` rejected as a GCP key id); grants per-key `roles/cloudkms.signer`; **writes no secrets**.
- **No secret-writer** for Cloudflare or Vercel anywhere in either repo.
- **No WIF / keyless** transport — every runtime needs a raw `GCP_SERVICE_ACCOUNT_JSON`.

## Target architecture

### 1. Declarative manifest (single source of truth)
A repo-level `kms.manifest.json` describing the keyring + each signing identity and where its runtime
config is written:

```jsonc
{
  "project": "churchcore2", "location": "us-central1", "keyRing": "content-signers",
  "runtimeServiceAccount": "agenticprimitives-signer@churchcore2.iam.gserviceaccount.com",
  "identities": [
    { "name": "fbsb.impact",            "targets": [{ "platform": "cloudflare", "worker": "demo-bible-mcp", "env": "production", "keyMapSecret": "CONTENT_SIGNER_KEYS" }] },
    { "name": "lbsb.impact",            "targets": [{ "platform": "cloudflare", "worker": "demo-bible-mcp", "env": "production", "keyMapSecret": "CONTENT_SIGNER_KEYS" }] },
    { "name": "scripture-resolver.impact", "targets": [{ "platform": "cloudflare", "worker": "demo-bible-mcp", "env": "production", "keyMapSecret": "CONTENT_SIGNER_KEYS" }] },
    { "name": "demo-validator.impact",  "targets": [{ "platform": "vercel", "project": "scripture-validator", "env": "production", "keySecret": "VALIDATOR_KMS_KEY", "leafSecret": "VALIDATOR_DELEGATION_LEAF", "saSecret": "VALIDATOR_SA" }] }
  ]
}
```

### 2. Orchestrator: `ap-kms apply` (new CLI in key-custody, or `ap-provision-gcp` v2)
Given the manifest + a securely-sourced admin SA (file / secret manager, never echoed), it runs the
whole pipeline and is idempotent:
1. **Provision**: keyring + per-identity HSM secp256k1 keys, per-key `roles/cloudkms.signerVerifier`
   (signer + viewPublicKey). Accept dotted identity names; sanitize to GCP key ids internally and keep
   the `name ↔ keyVersion` map.
2. **Derive + validate** each key's EVM address (`addressFromSpkiPem`); fail closed on surprises.
3. **Resolve** each `name` → SA via agent-naming ("once smart agents are configured").
4. **Bind**: detect whether the owner-signed delegation leaf (SA → KMS key) exists; if missing, emit the
   exact ceremony link / payload (the home content-signer ceremony) — do not fabricate authorization.
5. **Wire**: write the minimal runtime secrets to each identity's target(s) with **no echo**:
   - `GCP_SERVICE_ACCOUNT_JSON` (base64) — Cloudflare via wrangler/API, Vercel via REST API.
   - the key map (`CONTENT_SIGNER_KEYS`) or single key path (`VALIDATOR_KMS_KEY`) per the target shape.
   - the delegation leaf where the runtime expects it in env (validator).
6. **Report**: per identity — provisioned ✓, address, SA resolved ✓, bound ✓/pending-ceremony, wired ✓.

### 3. Deploy-target writers (new, in key-custody or a sibling tool)
- **Cloudflare**: `wrangler secret put` (piped, no echo) or the CF API (`CLOUDFLARE_API_TOKEN`).
- **Vercel**: REST API (`/v10/projects/{id}/env`, base64 value, `type:"encrypted"`) — `vercel env add`
  from stdin is unreliable (observed storing empty). Resolve project id + team via the API.

### 4. (Phase 2) Keyless via Workload Identity Federation
Add a federated-token transport to `/kms-core` (`createGcpKmsTransport` variant accepting an async token
fetcher) so a Worker/Vercel function authenticates via WIF/OIDC and holds **no** `GCP_SERVICE_ACCOUNT_JSON`.
Requires a GCP workload-identity pool trusting the platform's OIDC token. This is the end-state; the
JSON-key path above is the demo-phase bridge.

## Package / tool changes (`@agenticprimitives/key-custody`, Ring 0)
1. **Built-in gcloud-free REST `StepExecutor`** for `executeGcpProvision` (port this repo's REST
   provisioning) so provisioning needs no `gcloud`. Keep the gcloud executor as an option.
2. **Dotted-label support** in `planGcpProvision`: accept `fbsb.impact`, sanitize internally, return the
   `name → keyVersion` map keyed by the original name.
3. **`signerVerifier`** option for the IAM grant (the runtime needs `viewPublicKey`).
4. **Secret-writers** module (`./deploy` subpath): Cloudflare + Vercel, value-from-provider, no echo.
5. **`ap-kms` orchestrator CLI** (manifest-driven) wrapping 1–4 + agent-naming resolution + ceremony
   detection.
6. **(Phase 2)** WIF/brokered-token transport in `/kms-core`.

## This repo
- Add `kms.manifest.json`; replace `scripts/provision-content-signer-keys.mjs` with `ap-kms apply`.
- Runtime consumers (validator `/kms-core`, MCP `GcpKmsSigner`) are unchanged.

## Acceptance
- `ap-kms apply` provisions, validates addresses, resolves SAs, and writes only the minimal runtime
  config to each target — **no raw SA JSON echoed**, idempotent, fail-closed, reporting bound vs pending.
- Adding a KMS app = one manifest entry + `ap-kms apply`.
- Stretch (Phase 2): runtimes hold no `GCP_SERVICE_ACCOUNT_JSON` (WIF).
```

## Phasing
1. **P1 — package foundation**: REST executor, dotted labels, signerVerifier, secret-writers (CF+Vercel). Ship in key-custody.
2. **P2 — orchestrator**: `ap-kms` manifest CLI tying it together + agent-naming resolve + ceremony detection.
3. **P3 — adopt here**: manifest + retire the bespoke script; re-wire MCP + validator via `ap-kms`.
4. **P4 — keyless**: WIF transport; drop `GCP_SERVICE_ACCOUNT_JSON` from runtimes.
