# KMS configuration flow — keyed on agent naming-service name + Smart Agent

How a signing identity gets a Cloud-KMS key wired up, anchored on its **agent-naming name** and its
**Smart Agent (SA)**. No service ever holds a private key: the agent's SA *authorizes* a rotatable
HSM-backed KMS key to sign on its behalf, and verifiers root trust back in the SA (and thus the name).

Related: [[ap-kms-orchestrator]] (the tool), `docs/spec-automated-kms-provisioning-deploy.md` (design),
[[no-held-keys-rule]], [[spec-276-kms-consumer-surface-migration]], [[delegated-content-trust]].

## The identity triad

```
   name  ──(agent-naming resolveName)──►  Smart Agent (SA)  ──(owner-signed ERC-7710 leaf)──►  KMS delegate key
 "fbsb.impact"                          0xA2afBA…b867                                        0x217cf9…ab87 (HSM)
   │                                        │                                                    │
   │ AgentNameRegistry (home 0x15F7ed…)     │ ERC-1271 isValidSignature                          │ EC_SIGN_SECP256K1_SHA256,
   │ + UniversalResolver (0x7d777d…)        │ (custodian-controlled account)                     │ never leaves Cloud KMS HSM
   ▼                                        ▼                                                    ▼
 canonical, on-chain                  the trust anchor                                   the day-to-day signer
```

- **name** — the agent-naming label (e.g. `fbsb.impact`, `demo-validator.impact`). Resolves on-chain via
  `AgentNamingClient.resolveName(name)` against the **home** registry (`0x15F7ed064A230C011b0244A14fD9653f011d609B`)
  + universal resolver (`0x7d777d2d0bbc1806B9Cc779121C27fbaAaFDb60b`), chain `84532` (Base Sepolia).
- **Smart Agent (SA)** — the account the name resolves to (e.g. `fbsb.impact → 0xA2afBA…b867`). Controlled
  by its custodian (passkey/social/SIWE). It is the **root of trust**; it never exposes a key.
- **KMS delegate key** — a per-identity HSM secp256k1 key in Google Cloud KMS. Its EVM address is derived
  from the key's public key (`addressFromSpkiPem`). The SA authorizes this address to sign for it.

## Configuration flow (one run of `pnpm kms:apply`, + the one human ceremony)

```
 ┌─ ap-kms (kms.manifest.json) ───────────────────────────────────────────────────────────┐
 │ 1. PROVISION   per name → HSM key "fbsb-impact"  (keyId = name, dots→dashes)             │
 │                grant runtime SA  roles/cloudkms.signerVerifier  ON THAT KEY (per-key)    │
 │ 2. DERIVE      addressFromSpkiPem(publicKey)  →  delegate key 0x217cf9…ab87              │
 │ 3. RESOLVE     resolveName("fbsb.impact")  →  SA 0xA2afBA…b867                            │
 └──────────────────────────────────────────────────────────────────────────────────────────┘
            │ (delegate address + SA are now known)
            ▼
 ┌─ 4. AUTHORIZE — the ONE human step (content-signer ceremony, home OIDC) ───────────────────┐
 │  the SA's custodian signs a ROOT ERC-7710 delegation leaf:                                  │
 │     { delegator: SA, delegate: KMS delegate key, authority: ROOT_AUTHORITY, …, signature }  │
 │  hashDelegation(leaf, chainId, DelegationManager) signed via the SA (ERC-1271).             │
 │  stored by POST /tools/store_content_signer → D1 `content_signers` (after re-verifying the  │
 │  SA actually signed it — only the identity's custodian can produce a valid leaf).           │
 └──────────────────────────────────────────────────────────────────────────────────────────┘
            │
            ▼
 ┌─ 5. WIRE — ap-kms --write pushes the minimal runtime config to each deploy target (no echo) ┐
 │  Cloudflare (MCP):  CONTENT_SIGNER_KEYS = { name → cryptoKeyVersion } ,  GCP_SERVICE_ACCOUNT_JSON │
 │  Vercel (validator): VALIDATOR_KMS_KEY = cryptoKeyVersion , VALIDATOR_SA = SA ,                   │
 │                      VALIDATOR_DELEGATION_LEAF (from the ceremony) , GCP_SERVICE_ACCOUNT_JSON      │
 └──────────────────────────────────────────────────────────────────────────────────────────┘
            │
            ▼
 ┌─ 6. RUN — the agent signs with its KMS delegate; the proof carries the leaf ───────────────┐
 │  MCP        trust-context buildDelegated: resolveName→SA, resolveDelegatedSigner(chain=[leaf],│
 │             signer=GcpKmsSigner) → kmsCredentialSigner signs descriptors/citations AS the SA, │
 │             attaching delegatingSigner { delegatorIssuer: SA, delegateKey, delegationLeaf }.  │
 │  Validator  kms-core signDigestWithKms(VALIDATOR_KMS_KEY) signs the attestation; proof carries│
 │             the leaf; on first sign it asserts addressFromSpkiPem(key) === leaf.delegate.     │
 └──────────────────────────────────────────────────────────────────────────────────────────┘
```

## Trust chain at verification time

A verifier (e.g. `demo-validator`) checks a signed descriptor/citation/attestation **without ever needing
the agent's key**:

1. **Recover** the signature → the **delegate key** (EOA ecrecover), OR validate it directly against the
   SA via ERC-1271 (`AgentAccountClient.isValidSignature`). (`verifySignature` tries both.)
2. **Authorize the delegate** — `verifyDelegatedAuthority`: the proof's `delegationLeaf` must bind
   `delegator: SA → delegate: <recovered key>`, and `hashDelegation(leaf)` must be **ERC-1271-validated by
   the SA**. Only the SA's custodian could have produced that leaf.
3. **Anchor in the name** — the SA is the canonical agent the **name** resolves to (agent-naming) and is in
   the verifier's trusted-issuer set. So: signature → delegate → (owner-signed leaf) → SA → name. Trust is
   rooted in the named agent; the KMS key is a rotatable, revocable stand-in.

Because the leaf is owner-signed and the day-to-day signer is the HSM key, **rotating** a key = provision a
new key, run the ceremony to authorize the new delegate, re-wire — no change to the SA or the name. **Revoke**
= drop the stored leaf (the delegate stops verifying).

## Components & files

| Concern | Where |
|---|---|
| name → SA resolution | `@agenticprimitives/agent-naming` `AgentNamingClient.resolveName` |
| SA / ERC-1271 | `@agenticprimitives/agent-account` `AgentAccountClient.isValidSignature` |
| delegation leaf hash | `@agenticprimitives/delegation` `hashDelegation`, `buildSessionDelegation` (`authority: ROOT_AUTHORITY`) |
| KMS signing (peer-free) | `@agenticprimitives/key-custody/kms-core` `signDigestWithKms`, `createGcpKmsTransport`, `addressFromSpkiPem` |
| KMS backend / signer | `@agenticprimitives/key-custody` `GcpKmsSigner` (`KmsAccountBackend`) |
| delegated-signer resolution | `@agenticprimitives/delegated-signer` `resolveDelegatedSigner` |
| credential signer | `@agenticprimitives/verifiable-credentials` `kmsCredentialSigner` |
| stored bindings (per name) | MCP D1 `content_signers` (issuer_name, issuer_sa, delegate_key, delegation_leaf) |
| ceremony endpoints | MCP `/tools/content_signer_keys` (name→SA→delegate), `/tools/store_content_signer`, `/tools/list_content_signers` |
| MCP runtime orchestration | `apps/demo-bible-mcp/src/lib/trust-context.ts` (`buildDelegated`, `contentSignerForIssuer`) |
| validator runtime | `apps/demo-validator/src/attestation.ts` |
| config orchestrator | `scripts/kms/*` + `kms.manifest.json` (`pnpm kms:apply`) |

## Add a new KMS-backed agent

1. **Register the name → SA** in agent-naming (the agent's custodian creates the SA + claims the name).
2. **Declare it** in `kms.manifest.json`: one `identities[]` entry with `targets[]` (which deploy target(s)
   wire it — a Cloudflare `keyMapSecret` map and/or a Vercel `keySecret`/`saSecret`/`leafSecret`).
3. **`pnpm kms:apply --write`** — provisions the HSM key, grants per-key IAM, derives the delegate address,
   resolves the SA, and writes the runtime secrets. It prints the `address → SA` to authorize.
4. **Run the ceremony** — the SA's custodian authorizes the printed delegate address (the home content-signer
   ceremony → `store_content_signer`). This is the only manual step.
5. **`pnpm kms:apply --verify`** — confirms the live KMS delegate === the owner-authorized delegate for every
   identity (exit non-zero on drift). Redeploy the consumer if its env changed.

## Verify / drift

`pnpm kms:apply --verify` (read-only) per identity: resolves the name → SA, derives the **live** KMS delegate
from the key's public key, and compares both against the stored `content_signers` binding. Green = the agent
is still hooked to its own key; a mismatch flags a rotated/re-provisioned key whose ceremony wasn't re-run.
