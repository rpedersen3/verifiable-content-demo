# Impact — social sign-in (Google / YouVersion) setup

The error

```json
{"error":"Google OIDC not configured (set GOOGLE_CLIENT_ID + GOOGLE_REDIRECT_URI). See OIDC-SETUP.md."}
```

means the impact broker has no Google OAuth config. Google sign-in needs **three env vars on the
Vercel project** plus a **redirect URI registered in Google Cloud Console**. (Passkey + SIWE
sign-in work without any of this; only social sign-in needs it.)

Impact is a Next.js app on **Vercel** — so the values are **Vercel Environment Variables** (the
agenticprimitives `impact/OIDC-SETUP.md` is the same flow but for Cloudflare Pages).

---

## 1. Google Cloud Console (the one step only you can do)

**APIs & Services → Credentials.** Either reuse an existing OAuth **Web application** client or
create one. On that client set:

- **Authorized JavaScript origins:** your impact origin, e.g. `https://www.churchcore.me`
  (and `https://churchcore.me` if you serve there too).
- **Authorized redirect URIs (must EXACTLY match `GOOGLE_REDIRECT_URI`):**
  `https://<your-impact-origin>/oidc/google/callback`
  — e.g. `https://www.churchcore.me/oidc/google/callback`. One entry **per origin** you sign in on.

Copy the **Client ID** and **Client secret**.

> Reusing the existing OAuth client is fine — just **add** impact's `/oidc/google/callback` to that
> client's Authorized redirect URIs. Google rejects any `redirect_uri` not registered exactly.

---

## 2. Vercel env vars (impact project → Settings → Environment Variables, Production)

| Var | Value | Sensitive |
|-----|-------|-----------|
| `GOOGLE_CLIENT_ID` | `…apps.googleusercontent.com` | no |
| `GOOGLE_CLIENT_SECRET` | the client secret (used only server-side in the callback token exchange) | **yes** |
| `GOOGLE_REDIRECT_URI` | `https://<your-impact-origin>/oidc/google/callback` — **exact**, no trailing space | no |

Then **redeploy** (Vercel bakes env at build/runtime; a redeploy picks them up).

`GOOGLE_REDIRECT_URI` must match the Google-console entry **character-for-character**, including
scheme, host (`www.` or not), and path. A trailing space is the classic failure — `app/_lib/env.ts`
trims values, but register them clean.

---

## 3. KV is required in production

The OIDC `state` (PKCE verifier + nonce) is written on `/oidc/google/start` and read on
`/oidc/google/callback`, which may run on **different serverless instances**. So the broker's
`AUTH_CODES` store must be a real **Vercel KV / Upstash Redis**, not the in-memory fallback:

- `KV_REST_API_URL` + `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`).

Without it, sign-in starts but the callback can't find the `state` and fails.

---

## 4. New social home → KMS custody (optional, for first-time Google/YouVersion users)

A Google/YouVersion identity that **verifies but has no home yet** needs the server custody bridge to
mint a KMS-custodied Smart Agent; otherwise the callback returns `?connect_status=bootstrap`. To
enable it, also set on Vercel:

- `A2A_CUSTODY_URL` = your impact-a2a URL (defaults to `IMPACT_A2A_URL`)
- `A2A_CUSTODY_BRIDGE_SECRET` = a shared secret that **matches** the same secret set on
  **impact-a2a** (`wrangler secret put A2A_CUSTODY_BRIDGE_SECRET --env production`).
- `SSO_AUD` (default `impact`) must equal impact-a2a's `SSO_AUD`.

Until set, social sign-in works for an **existing** linked identity but a brand-new one can't get a
home (the entry screen surfaces this clearly).

---

## 5. YouVersion

YouVersion needs no redirect env — the redirect URI is derived from the live host
(`…/oidc/youversion/callback`). The public PKCE `YOUVERSION_CLIENT_ID` (App Key) is defaulted in
`app/_lib/env.ts`; override with the env var only if it changes. Register
`https://<your-impact-origin>/oidc/youversion/callback` in the YouVersion developer app, and (for a
new social home) the same `A2A_CUSTODY_*` bridge as §4 applies.

---

## Quick checklist

- [ ] Google OAuth client has `https://<origin>/oidc/google/callback` in Authorized redirect URIs
- [ ] Vercel: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (sensitive), `GOOGLE_REDIRECT_URI`
- [ ] Vercel: `KV_REST_API_URL` + `KV_REST_API_TOKEN` (real KV store)
- [ ] (new social homes) Vercel `A2A_CUSTODY_URL` + `A2A_CUSTODY_BRIDGE_SECRET` matching impact-a2a
- [ ] Redeploy the Vercel project

See also `docs/impact-apps-setup.md` §8 for the full Vercel env surface, and `.env.example`.
