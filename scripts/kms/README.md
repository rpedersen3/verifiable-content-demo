# Managed-KMS orchestration (`pnpm kms:apply`)

Driven by the published **`@agenticprimitives/ap-kms`** (provider-agnostic orchestrator). This repo keeps
only the declarative manifest + the app-side secret writers; all orchestration logic lives in the package.

| File | Role |
|---|---|
| `../../kms.manifest.json` | Single source of truth: identities, deployments, GCP/keyring, naming + bindings config. |
| `secret-writers.ts` | App-side deploy-platform writers (Cloudflare `wrangler` / Vercel REST) + a `writeSecret(deployment, name, value)` dispatcher injected into the package. The package ships **no** provider code (ADR-0020). |
| `../kms-apply.ts` | Thin entry: `loadManifest` → `makeNodeDeps({ writeSecret })` → `applyKmsManifest` / `verifyKmsManifest`. |

## Commands

```bash
pnpm kms:apply             # provision keys + per-key IAM + derive/verify addr + resolve SA + REPORT (no writes)
pnpm kms:apply --dry-run   # print the plan only (no GCP calls, no SA needed beyond load)
pnpm kms:apply --write     # also push runtime secrets to the deploy targets (no echo)
pnpm kms:apply --verify    # READ-ONLY drift check (see below)
pnpm kms:apply --manifest path/to/kms.manifest.json
```

## Config / prerequisites

- **Admin service account** — `manifest.runtimeServiceAccountFile` (`~/content-signer-admin-sa.json`). Used to
  provision and to derive each KMS key's public key. Single-line/base64 JSON (strict `parseServiceAccountJson`).
- **`KMS_NAMING_RPC_URL`** — a Base Sepolia (chainId 84532) RPC for name→Smart-Agent resolution via the
  `manifest.naming` universal resolver. The env var name is kept in the manifest (`naming.rpcUrlEnv`); the URL
  stays out of the manifest because it carries an API key. Sources:
  - the Alchemy URL already in an app's local `.dev.vars` (`RPC_URL=…`), or
  - the public `https://sepolia.base.org` (works read-only).

  If unset, name resolution is skipped (a warning prints) and `--verify` still checks the live-vs-stored
  delegate but cannot compare the resolved SA.
- **`manifest.bindingsUrl`** — the prod MCP (`/tools/list_content_signers`); read by `--verify` for the stored,
  owner-authorized delegates. No auth needed (public POST).

### Running `--verify` against live

```bash
# pull the RPC from a local .dev.vars (no key echoed), then verify
RPC=$(grep -rhoE "RPC_URL=https://[^[:space:]]+" apps/*/.dev.vars | head -1 | sed 's/^RPC_URL=//')
KMS_NAMING_RPC_URL="$RPC" pnpm kms:apply --verify
```

`--verify` is read-only: for each identity it derives the **live** KMS delegate (from the key's public key),
fetches the **owner-authorized** delegate + issuer SA from `bindingsUrl`, resolves the name → SA on-chain, and
flags drift if the live delegate ≠ stored delegate or the resolved SA ≠ stored SA. Non-zero exit on drift.

**Baseline (2026-06-17, live):** all 4 identities `bound` — live KMS delegate === owner-authorized delegate:

| Identity | KMS delegate | Smart Agent |
|---|---|---|
| `fbsb.impact` | `0x217cf9…ab87` | `0xA2afBA…b867` |
| `lbsb.impact` | `0x253bcc…273e` | `0x91B438…eAbe` |
| `scripture-resolver.impact` | `0x9c5303…4d38` | `0x700848…4378` |
| `demo-validator.impact` | `0x00314c…6177` | `0x484861…3214` |

## See also

- `docs/kms-agent-configuration-flow.md` — the name→Smart-Agent→KMS-delegate configuration flow.
- `docs/spec-automated-kms-provisioning-deploy.md` — full design + phasing.
- The owner-signed SA→key **delegation leaf** is the one human step (content-signer ceremony); this tool
  reports binding status but never fabricates authorization. See `docs/content-signer-ceremony-spec.md`.
