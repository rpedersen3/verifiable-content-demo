# Social Connect Hardening

## Position

Keep OAuth/OIDC and KMS envelope encryption, but do not ship the current shared-master topology as a production-hardened solution.

The encryption primitive is good. The key hierarchy, recovery design, and social-account custody model still have a fleet-wide failure domain.

Losing the encryption key does not technically invalidate the Google or YouVersion authorization at the provider. It makes stored access and refresh tokens unreadable, forcing users to authorize again. A compromise is worse: the connections remain valid while an attacker may be able to use stolen refresh tokens.

## What The Current Implementation Gets Right

The YouVersion token vault uses a sound envelope-encryption pattern:

- A fresh AES-GCM data-encryption key is generated for each token record.
- Access and refresh tokens are encrypted with that DEK.
- The DEK is wrapped by Google Cloud KMS.
- AAD binds the ciphertext to the provider and person Smart Account.
- Plaintext tokens stay server-side and are not returned to relying applications.

That broadly matches Google's recommended envelope-encryption design: locally generated DEKs, a new DEK for each write or user context, AES-GCM, and a centrally managed KEK that never leaves KMS.

AAD is useful against ciphertext swapping and confused-deputy problems, but it does not reduce the consequences of the KEK itself being compromised.

## Why The Current Topology Is Not Yet Hardened

### 1. One KEK Remains A Global Failure Domain

`fed-token.ts` selects one `GCP_KMS_ENCRYPT_KEY_NAME` for all federated-token records. Every record gets a separate DEK, but all those DEKs are ultimately recoverable through the same KEK.

Therefore:

- Destroy or permanently lose that KEK: every stored social token becomes unreadable.
- Compromise its decrypt authority: potentially every stored social token becomes accessible.
- Disable it temporarily: every refresh and YouVersion read fails.

The durability runbook correctly calls this out: loss of the wrap key makes all envelope-encrypted records unrecoverable and requires an explicit backup, replication, or threshold strategy before production.

### 2. Stored Key Id Is Not Used To Choose The Decrypting Key

The stored token record contains `keyId` and `keyVersion`, but `GcpKmsProvider.decryptSessionDataKey()` always calls the currently configured `this.keyName`. It does not resolve the provider from `input.keyId`.

Native GCP key-version rotation under the same CryptoKey can work, but changing to another CryptoKey resource, introducing shards, or restoring through a recovery key will not work automatically. The architecture needs a key registry and decrypt routing based on the recorded, allowlisted key reference.

Google also notes that rotation does not re-encrypt existing ciphertext. Old versions must remain available until dependent ciphertext has been migrated.

### 3. Smart Account Custody Has A Larger Root-Key Problem

The Google/YouVersion custody path derives each subject's signing key deterministically from one server master. The source explicitly documents that compromising the master compromises all Google members.

More importantly, the production KMS implementation of per-subject derivation is not currently built; the code supports local deterministic derivation and deliberately fails for GCP/AWS KMS backends.

This is more serious than losing encrypted OAuth tokens. Losing the token KEK means "reconnect YouVersion." Losing the deterministic signing root may mean "cannot reproduce or control any existing social-custodied Smart Accounts." Compromising it may give an attacker control over all of them.

### 4. Token Storage Is Best-Effort

The YouVersion callback catches and discards token-custody failures while allowing sign-in to complete. That can leave the UI or identity link appearing connected even though the access/refresh token was never safely persisted.

For a production data connection, either:

- Complete the connection only after durable token storage succeeds.
- Record a clear `token_storage_pending` or `reauth_required` state and retry through a durable queue.

### 5. The Repo Does Not Claim Production Readiness

The checked-in production profile still defaults to explicitly demo-only local signer and envelope-key opt-ins unless deployment overrides them with GCP KMS.

The repository's readiness audit describes the system as test/pilot-ready on testnet, but not production-ready.

## Recommended Production Architecture

Treat social connect as three separate security domains.

| Domain | Production behavior |
| --- | --- |
| OIDC identity association | Persist `(issuer, subject) -> canonical person/SA`. This mapping survives token-key loss. A fresh OIDC login can prove the association again. |
| OAuth token custody | Per-record DEKs, KMS wrapping, independent recovery wrapping, scoped revocation, and reauthorization. |
| Smart Account control | Per-person non-exportable key, user passkey, or threshold custody. Do not derive every user's sole control key from one online global secret. |

## OAuth Access And Refresh Tokens

Keep the per-record DEK approach, but wrap each DEK twice:

```text
OAuth token
   └── AES-GCM with random per-record DEK
         ├── DEK wrapped by active KEK
         └── DEK wrapped by recovery KEK
```

The active KEK can be an HSM-backed, multi-region GCP key used by the runtime. The recovery KEK should be in a separate project, preferably a separate administrative domain, with no routine access by the A2A Worker. Recovery use should require a break-glass workflow and multiple approvals.

A recovery key adds another potential decrypt path, so its IAM isolation is load-bearing. HSM protection makes extraction harder, while multi-region placement improves service availability; neither makes a deliberately destroyed key recoverable.

For a lower blast radius, select KEKs at one of these granularities:

- Provider + environment + shard: pragmatic default.
- Per tenant or organization: stronger isolation.
- Per person SA: strongest isolation and consistent with the accepted per-person key-domain ADR, but operationally more expensive. That ADR already rejects a shared vault master because one compromise reaches every person.

## Smart Account Custody

Do not use the same master for OAuth encryption and account signing.

For production social login, prefer one of these models:

- Preferred: Google/YouVersion OIDC authenticates the user, while a passkey or user-controlled wallet is the primary Smart Account custodian.
- Custodial model: provision a random asymmetric KMS/HSM key per person and persist its key resource reference against the stable SA.
- Higher-assurance model: threshold/MPC or multiple custodians, so no single server or cloud key has unilateral account control.

The OIDC credential should be a replaceable authentication facet, not the source material from which the permanent account-control key is deterministically regenerated. The credential-recovery model should keep the canonical identity stable while credentials rotate.

## Concrete Repo Changes

Prioritize these changes:

- Replace `envelopeProvider()` with a keyring or key resolver that chooses an approved key from the stored `keyId`.
- Store multiple wraps per record, such as primary and recovery, plus an envelope schema version.
- Support dual-read/single-write rotation: write with the newest key, read older wraps, then rewrap the DEK.
- Keep old key versions enabled until an inventory confirms zero dependent records.
- Replace `GCP_SERVICE_ACCOUNT_JSON` with Workload Identity Federation or another short-lived workload credential where possible.
- Separate key administrators from key users; the runtime should have encrypt/decrypt only and no disable/destroy/version-management permissions.
- Make token-storage success part of the connection state instead of silently swallowing failure.
- On refresh, atomically persist any replacement refresh token returned by the provider. OAuth security guidance requires strong protection for refresh tokens and recommends rotation or sender-constrained tokens for public clients where supported.
- Add quarterly drills for active-key loss, recovery-key use, complete rewrap, provider-token revocation, and mass `reauth_required` handling.

Recommended balance for this system: use per-person custody keys for Smart Account control, and use per-provider/environment/shard token KEKs with an independently administered recovery wrap. That retains the current envelope-encryption work, avoids a single master controlling every security function, and ensures one KMS incident does not automatically destroy every user's identity and social connection.
