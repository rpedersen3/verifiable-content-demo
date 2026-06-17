# Spec: Automated KMS provisioning + keyless deploy wiring

Status: **proposed** (deferred — captured 2026-06-16, to implement later)
Related: spec 266 (delegated content trust), spec 276 (KMS consumer surface), `scripts/provision-content-signer-keys.mjs`, [[validator-kms-signing-live]]

## Motivation

Manual `GCP_SERVICE_ACCOUNT_JSON` pasting into terminals is exactly the operator footgun
spec 276 set out to remove. Today provisioning + deploy wiring is several manual steps with
raw service-account JSON moving by copy/paste. Automate the whole chain, and move toward a
posture where the runtime needs **no long-lived JSON key at all**.

## Target posture

- **No raw service-account JSON pasted into terminals.**
- Prefer **GCP Workload Identity Federation (WIF)** or SA **impersonation** over long-lived JSON keys.
- Provision KMS keys + IAM via `ap-provision-gcp`.
- Generate/validate the key map automatically.
- Write only the **minimal** runtime secrets/config to the deploy target.
- **Fail closed** if required bindings are missing.
- Never print private JSON to stdout/logs.

## Desired flow

```
ap-provision-gcp \
  --project <project> --location us-central1 --keyring content-signers \
  --identity fbsb.impact --identity lbsb.impact \
  --identity demo-validator.impact --identity scripture-resolver.impact \
  --runtime-service-account <runtime-sa>

# then a deploy adapter writes the runtime secrets/config:
ap-provision-gcp ... --write-cloudflare --env production
```

What must be automated:
1. Create/verify HSM KMS keys.
2. Grant **per-key** `roles/cloudkms.signerVerifier`.
3. Derive each HSM Ethereum address.
4. Emit `CONTENT_SIGNER_KEYS`.
5. Validate every configured key address (against the stored `content_signers` leaf delegate).
6. Optionally set Cloudflare (Wrangler/API) **and** Vercel secrets — reading the SA from a secure
   file / secret manager, never echoing.

## Gap analysis (as of `@agenticprimitives/key-custody@1.0.0-alpha.10`, `delegated-signer@0.0.0-alpha.1`)

The published `ap-provision-gcp@alpha.1` does **not** yet support the desired flow:
- Flags are `--project --location --keyring --service-account --identities a,b,c [--protection] [--dry-run]`
  — no repeated `--identity`, no `--runtime-service-account`, **no `--write-cloudflare`, no `--env`**.
- It **shells out to `gcloud`** (must be installed + authenticated) — not gcloud-free.
- It grants `roles/cloudkms.signer` **per-key** (includes `viewPublicKey`, so sufficient) — not `signerVerifier`.
- It **rejects dotted identity labels** (`fbsb.impact` is an invalid GCP key id; must pass `fbsb-impact`
  and re-map back to the issuer name for `CONTENT_SIGNER_KEYS`).

WIF / keyless runtime is **blocked upstream**: key-custody's only KMS transport
(`createGcpKmsTransport`) takes a `ServiceAccount {client_email, private_key}` and mints an SA-JWT.
There is no federated-token / impersonation transport in `kms-core`, so the Worker cannot drop
`GCP_SERVICE_ACCOUNT_JSON` until that exists. (A CF Worker doing GCP WIF also needs an OIDC
workload-identity-pool configured to trust the Worker's token.)

## Proposed work

### A. This repo (achievable now) — a deploy adapter
Extend `scripts/provision-content-signer-keys.mjs` (or a new `scripts/provision-and-wire.mjs`) into a
gcloud-free adapter that runs the full chain with no raw JSON in the terminal:
1. provision/verify HSM keys; grant **per-key `roles/cloudkms.signerVerifier`** (tighter than the
   current keyring-level grant);
2. derive every key's EVM address and **validate** it against the stored `content_signers` leaf —
   **fail closed** on mismatch;
3. emit + validate `CONTENT_SIGNER_KEYS`;
4. read the SA from a **secure file / secret manager** (never stdout) and set Cloudflare secrets via
   piped `wrangler secret put` (`--write-cloudflare --env production`);
5. optionally set Vercel env (`vercel env`) for the validator.

Open decision: keep it **gcloud-free REST** (recommended — preserves "drop the key and run", no gcloud
dependency) vs. wrap the `ap-provision-gcp` CLI (adds a gcloud requirement).

### B. Upstream (`@agenticprimitives/key-custody`, Ring 0)
1. `ap-provision-gcp`: secret-manager / `--write-cloudflare` (and `--write-vercel`) integration; accept
   dotted identity labels with internal sanitize+re-map; option for `signerVerifier`.
2. A **WIF / brokered-token KMS transport** in `kms-core` so the runtime needs no JSON key — the
   "best version" where the Worker authenticates via federation/impersonation.

## Acceptance
- One command provisions keys, validates all addresses, and writes only the minimal runtime config to
  the deploy target(s), with **no raw SA JSON echoed** and **fail-closed** on any missing binding.
- Stretch (upstream): runtime holds **no** `GCP_SERVICE_ACCOUNT_JSON`; signing authenticates via WIF.
