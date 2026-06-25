# Spec: fix the owner-op ceremony (content-signer / subscription-collect) — run it on the home session

**Repo:** `agenticprimitives` → `apps/demo-sso-next` (+ `packages/connect`)
**Owner of this work:** the agenticprimitives project (it owns the home auth model + can test the browser flow + publish).
**Consumer that surfaced it:** `verifiable-content-demo` (demo-corpus relying app) — its side is already correct; no changes needed there.

---

## 1. Problem

The **owner-operation ceremonies** — `content-signer` (spec 266: owner authorizes an issuer SA → Cloud-KMS signing key) and `subscription-collect` (spec 272) — fail when launched from a relying app (e.g. `demo-corpus`). Instead of running the ceremony, the home falls through to a normal site-login grant and returns a **bare `?code`** to the relying app, so nothing is signed/stored and the user sees no result.

This is the **single recurring root cause behind all 4 KMS integrations** cycling. Each integration has been unblocked only by a manual hand-signed-leaf bypass, which is exactly what we want to eliminate.

### Symptom
Relying app redirects the owner to `https://www.impact-agent.me/?...&delegation_template=content-signer&content_signer_target=<agent>&collect_token=<id_token>&agent_name=` → ceremony does **not** run → returns `?code` (no `?collect=1`, no consent sheet, no signature prompt).

---

## 2. Root cause — two coupled gaps, plus one deployment trap

### Gap 1 — Recognition is cookie-only, and the cookie is absent at the ceremony origin
`EntryExperience.tsx` (~lines 114–126): for a name-deferred enroll it routes
`readSsoCookie() ? 'enroll-recognized' : 'enroll-entry'`.
`RecognizedEnroll.tsx` (~lines 105–110) then requires the `ap_sso` cookie and calls `fetchProfile(sso.token)` → `/me/profile`, which **only accepts `aud: 'demo-sso'`** (`server/me/handler.ts`, `const AUD = 'demo-sso'`, `verifyAgentSession(..., { expectedAud: AUD })`).

At the ceremony origin there is frequently **no `ap_sso` cookie** — the app only forwarded the relying-app OIDC id_token (`collect_token`, `aud: 'demo-corpus'`), which `/me/profile` rejects. Result → `onUnrecognized()` → `enroll-entry` (no owner-op branch) → bare `?code`.

### Gap 2 — The relying-app id_token has no credential kind
`mintIdToken` (`packages/connect/src/token.ts:271`) mints `{ iss, sub, aud, iat, exp, canonical_agent_id, nonce?, agent_name? }` — **no `principal` / credential kind**. So even if you recognize the owner *from the id_token*, you don't learn whether the custodian is **passkey / social / SIWE**, which the ceremony needs to know *how* to collect the signature (passkey rpId hop vs wallet popup vs server-side social/KMS). Worse: social/KMS leaf signing is **server-side** and needs a **home-session token** to authorize — a relying-app-audience id_token can't do that.

### Deployment trap — stale cached HTML can keep the old client flow alive
If a server-only check proves the new deployment is live, but the browser still falls through to "permission granted", inspect the HTML response for `/`.

Observed failure mode:

- `GET /me/owner-profile` is gone, proving the deployed server code changed.
- `GET /?cb=<random>` still returns an old CDN response with a non-zero `age` header.
- The CDN ignores the query string for `/`, so hard refresh and cache-busting URLs still serve stale HTML.
- That stale HTML references old Next chunk hashes, so the browser continues running the old `EntryExperience` / `RecognizedEnroll` resume logic even though the server is new.

This produces the exact symptom: the URL contains `delegation_template=content-signer`, `collect_token`, and `content_signer_target=scripture-resolver.impact`, but the live browser bundle behaves as if it only knows the normal site-login grant.

---

## 3. Decision: Option B — the ceremony runs on the owner's HOME SESSION

Rejected alternative (Option A): "carry the credential kind as a claim in the relying-app id_token." It only partially works:
- It still can't authorize **server-side** signing for social/KMS custodians (the id_token is relying-app-audience, not a home session) → you'd be back here for the next custodian type.
- It leaks `amr` (auth method) into every relying-app token.
- It needs bespoke claim plumbing and a new verification path.

**Option B is the correct architecture:** the home is the identity provider; a privileged home-side ceremony must act on the owner's **home session**, which is the authoritative carrier of (a) identity (SA), (b) credential kind (`principal.kind`), and (c) a usable token to authorize server-side signing — uniformly for passkey / social / SIWE. The relying-app `collect_token` is only a **binding hint** + downstream-authz token, never the identity source.

---

## 4. Fix design

### Step 0 (DIAGNOSE FIRST — likely the whole bug)
Confirm whether a **relying-app connect leaves a cross-subdomain `ap_sso` home session**. The owner authenticates at the home during the connect, so a session *should* exist by ceremony time.
- If the connect grant does **not** persist `ap_sso` → that single gap is the bug. Persist the home session on connect (the same `setSsoCookie`/`openSession` the home uses elsewhere), cross-subdomain (`.impact-agent.me`).
- If it *is* persisted but the ceremony still doesn't see it → check origin/domain/SameSite of the cookie and the recognition guards (`forceChooser` at `RecognizedEnroll.tsx:91–104`; `profile.deployed === false`; the passkey rpId hop at lines 118–124).

### Step 1 — Recognize the owner from the home session (existing path)
Keep `readSsoCookie() → fetchProfile(sso.token)` → it already returns the real `principal.kind` (credential) and SA. No new token parsing. `viaFromCredential(profile.credential, …)` then routes signing correctly for **any** custodian.

### Step 2 — Bind the session to the intended owner via `collect_token`
The `collect_token` is a home-signed OIDC id_token (verify with `verifyIdToken`, `packages/connect/src/token.ts:373`, against the relying app's `aud`). **Require `session.sub === collect_token.sub`** before running the ceremony — so a relying app can't start a ceremony for a *different* owner than the one it authenticated. The `collect_token` also remains the bearer for the downstream owner-gated a2a calls (`/admin/content-signer-keys`, `/admin/store-content-signer`) — unchanged.

### Step 3 — Graceful fallback when there is genuinely no session
Only if no `ap_sso` session exists, run a sign-in that **resumes into the content-signer branch** (not the standard grant). After sign-in the AgentSession exists with the real `principal.kind`, so Steps 1–2 apply. (This is the one place `EntryExperience` currently dead-ends owner-ops — `enroll-entry` must be able to resume an owner-op, not only the standard grant.)

### Step 4 — Make the home HTML non-cacheable
The home app must not let a CDN cache the SPA shell for `/` or owner-op entry URLs. Next static chunks can remain immutable, but the HTML document that points to them must revalidate or bypass cache.

Recommended fix in `apps/demo-sso-next/next.config.mjs`:

```js
async headers() {
  return [
    {
      source: '/(.*)',
      headers: securityHeaders,
    },
    {
      source: '/',
      headers: [
        { key: 'Cache-Control', value: 'no-store, max-age=0' },
        { key: 'CDN-Cache-Control', value: 'no-store' },
        { key: 'Vercel-CDN-Cache-Control', value: 'no-store' },
      ],
    },
  ];
}
```

If Cloudflare fronts `www.impact-agent.me`, also add a cache rule that bypasses cache for the HTML entry route(s), especially `/` with OIDC parameters. Purge the existing cached `/` response after deploying the header change.

### Net effect
The ceremony runs on a genuine home session for passkey / social / SIWE alike; `collect_token` is a binding hint + downstream authz; no credential reconstruction from a relying-app token.

---

## 5. Changes already pushed to `agenticprimitives` master (review + mostly revert)

These were authored from the *consumer* side (blind to the home model) and are imperfect:
- **`c5e8f1a`** — `EntryExperience`/`RecognizedEnroll`: route owner-ops-with-`collectToken` to `enroll-recognized` even without the cookie. *Instinct correct (don't dead-end owner-ops), but the resolution should be Option B (session), not the id_token path.*
- **`d7d3c52`** — added `/me/owner-profile` using `verifyAgentSession`. **Revert** (the token is a plain id_token, not an AgentSession).
- **`7d75d75`** — rewrote `/me/owner-profile` with `verifyIdToken` but defaults credential to `siwe-eoa`. **Revert** (Option A; wrong for passkey/social).

Recommend: revert `d7d3c52` + `7d75d75`; keep or rework `c5e8f1a` toward the Step-3 resume.

---

## 6. Code reference map

| What | Location |
|---|---|
| Ceremony routing (cookie → recognized vs entry) | `apps/demo-sso-next/src/components/onboarding/EntryExperience.tsx` ~114–126 |
| Recognition + content-signer branch | `apps/demo-sso-next/src/components/onboarding/RecognizedEnroll.tsx` 91–169 |
| `/me/profile` (aud `demo-sso`) | `apps/demo-sso-next/server/me/handler.ts` (`AUD`, `verifyAgentSession`) |
| OIDC id_token mint (no `principal`) | `packages/connect/src/token.ts:271` (`mintIdToken`) |
| OIDC id_token verify | `packages/connect/src/token.ts:373` (`verifyIdToken`) |
| Grant that mints the relying-app id_token | `apps/demo-sso-next/server/oidc/grant.ts` 106–119 (`sub = toCanonicalAgentId(CHAIN_ID, body.delegation.delegator)`) |
| Owner-op signing entrypoints | `apps/demo-sso-next/src/home/onboarding.ts` (`authorizeContentSigningForOwner` ~333, `collectDueSubscriptions` ~310) |
| Relying app registry (demo-corpus, a2aBase) | `apps/demo-sso-next/src/whitelabel/config.ts:97` (`collectionConfig.a2aBase`) |
| Relying-app token audience (consumer side) | `verifiable-content-demo/apps/demo-bible-a2a/src/index.ts` `ALLOWED_AUD = ['bible-explorer','demo-corpus']` |

---

## 7. Acceptance criteria

1. Owner connects to `demo-corpus` (as **each** custodian type — passkey, social, SIWE), opens Signing identities → **Authorize content signing** → ceremony **runs**: consent sheet shows, signature is collected via the correct method, leaf is stored, and the home returns **`?collect=1&collect_kind=content-signer`** (not a bare `?code`).
2. Works for `subscription-collect` the same way (shared path).
3. A ceremony where the home session's owner ≠ `collect_token.sub` is **rejected** (binding check).
4. No credential kind is added to relying-app id_tokens; no `/me/owner-profile`-style reconstruction remains.
5. Verified end-to-end in the demo: `demo-corpus-production` roster flips `scripture-resolver.impact` (SA `0x7008`) and `bsb.impact` (SA `0xf66c`) to ✓ Authorized.
6. `GET https://www.impact-agent.me/?cb=<random>` returns fresh HTML with `Cache-Control: no-store` or equivalent CDN bypass behavior; the `age` header is absent or `0` after purge.

---

## Appendix — current demo-side state (no action needed there)

- Demo aligned to the home's CURRENT Base Sepolia deployment (registry `0x15F7`, resolver `0xcC98`, uniResolver `0x7d77`, factory `0x3E68`, entryPoint `0x9B33`, delegationManager `0x3a8E`). Names resolve to the SAs created in the home.
- `scripture-resolver.impact` → SA `0x7008` (custodian `0x35fF`); KMS delegate `0x9c5303ed` provisioned; in MCP `CONTENT_SIGNER_KEYS`.
- demo-corpus initiates the ceremony correctly: forwards `collect_token` (the owner's relying-app id_token) + `content_signer_target`.
- Once the ceremony works, no demo changes are required to authorize the agents.
