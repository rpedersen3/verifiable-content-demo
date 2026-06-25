# Per-person vault key ceremony (spec 278)

How a person goes from **fail-closed** (no binding ⇒ `vault_key_unauthorized`) to a **live**
per-person-keyed vault. There is **no global key** — each person's vault objects are wrapped
under that person's own GCP Cloud KMS KEK, and impact-mcp may wield it only because the person
SA signed a `VaultKeyAuthorization` naming this server + that KEK (VKB-D1, VKB-D3).

The flow has three parties: the **operator** (provisions the KEK), the **person** (their SA
signs the authorization via their connected custodian), and **impact-mcp** (verifies + binds).

## 1. Operator — provision the person's KEK (spec 276)

Each person SA gets its own HSM secp256k1-adjacent **symmetric** encrypt/decrypt key, with
per-key IAM (master-key separation). Use the spec-276 provisioning helper:

```bash
# identity label = the person SA address (opaque to the provisioner)
ap-provision-gcp \
  --project "$GCP_PROJECT" --location "$GCP_LOCATION" --key-ring "$VAULT_KEY_RING" \
  --identity "<personSA>" \
  --runtime-service-account "<impact-mcp-runtime-SA-email>" \
  --protection-level HSM
# → prints the cryptoKey resource name (the binding's `kmsKeyRef`) + grants the runtime SA
#   roles/cloudkms.signer/cryptoKeyEncrypterDecrypter scoped to THAT key only.
```

Or **gcloud-free** (backlog B1) — `executeGcpProvision` with `createGcpRestStepExecutor` mints the
symmetric vault KEK over the Cloud KMS REST API (Workers-safe, idempotent), keyed by the person SA:

```ts
import { executeGcpProvision, createGcpRestStepExecutor } from '@agenticprimitives/key-custody/provision-gcp';
const { keyMap } = await executeGcpProvision(
  { project, location, keyRing, identities: [personSA], runtimeServiceAccount, purpose: 'encrypt-decrypt' },
  createGcpRestStepExecutor({ serviceAccountJson }),   // SA JSON or base64 (B4)
);
// keyMap[personSA] === the version-less cryptoKey resource → the binding's kmsKeyRef
// purpose:'encrypt-decrypt' ⇒ GOOGLE_SYMMETRIC_ENCRYPTION + roles/cloudkms.cryptoKeyEncrypterDecrypter (B3)
```

Then write the runtime secret to impact-mcp + the impact-mcp URL to the home (backlog B6 writers — no
echo, fail-closed; values come from env/stdin, never argv):

```bash
# GCP creds → impact-mcp (Cloudflare Worker secret, via wrangler stdin):
GCP_SA=... ; printf '%s' "$GCP_SA" | pnpm deploy:secret cloudflare --worker impact-mcp --env production --name GCP_SERVICE_ACCOUNT_JSON
# impact-mcp URL → the home (Vercel project env, via REST API — NOT `vercel env add`):
VERCEL_TOKEN=... printf '%s' "$IMPACT_MCP_URL" | pnpm deploy:secret vercel --project impact --name IMPACT_MCP_URL --target production
```

## 2. Person — sign the `VaultKeyAuthorization` (connected custodian)

The person's app (the home / connected-custodian surface) builds the unsigned authorization and
has the person SA sign its EIP-712 digest via the custody credential (passkey, or the `0x03`
approved-hash sentinel for passkey-only custodians — the same rail org-create uses):

```ts
import { buildVaultKeyAuthorization } from '<impact-mcp>/vault-key'; // or rebuild with delegation primitives
const { authorization, digest } = buildVaultKeyAuthorization(
  { CHAIN_ID, DELEGATION_MANAGER },
  {
    owner: personSA,
    vaultId: 'impact-mcp',
    kmsKeyRef,                              // from step 1
    serverKey: MCP_DELEGATE_KEY,       // the host's authorized delegate
    allowedResources: ['person-pii', 'org-sensitive', 'profile'],
    classificationCeiling: 'regulated.high',
    ops: ['read', 'write'],
    expiresAt: '<ISO, e.g. +90d>',
    salt: <random bigint>,
  },
);
authorization.signature = await custodian.sign(digest);   // person SA signs (ERC-1271 / 0x03)
```

The authorization carries a `VAULT_KEY_USE` caveat (non-subdelegable). It is **custody-policy-
governed** (ADR-0011) — a custody op, not a routine session delegation. The SA address never
changes; rotating the KEK later re-runs this step with a new `kmsKeyRef`.

## 3. impact-mcp — verify + bind

```
POST /custody/vault-key/bind
{ owner, vaultId, kmsKeyRef, allowedResources, classificationCeiling, ops, expiresAt, authorization }
```

impact-mcp verifies the authorization end-to-end — the `VAULT_KEY_USE` caveat matches the KEK +
scope, the delegator is the owner SA, and the **owner SA actually signed it** (ERC-1271 via the
`UniversalSignatureValidator`) — then persists the `VaultKeyBinding` (migration `0008`). On a bad
signature or scope mismatch it returns `401 authorization_invalid` and stores nothing.

After binding, the person's vault is live: `get_pii` / `get_org_sensitive` / `get_profile` /
`get|set|list_vault_record` and the OAuth `/mcp` path all run the full chain — entitlement →
DecryptGrant/KAS (which **also** re-checks this vault-key authorization per op) → required audit
→ decrypt under the person's KEK.

## Revocation / rotation

- **Revoke:** set `revoked_at` on the binding row (the live-lookup index skips it) ⇒ the person's
  vault returns to fail-closed immediately.
- **Rotate the KEK:** provision a new key version (never destroy the old — old ciphertext must stay
  decryptable), then re-run steps 2–3 with the new `kmsKeyRef`. The SA address is unchanged.
