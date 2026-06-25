# Impact — agent home

A faith-based home where **people** and **organizations** connect and steward their
agents. Modeled after [`agenticprimitives/demo-sso-next`](https://github.com/agentictrustlabs/agenticprimitives/tree/master/apps/demo-sso-next)
(the "Impact" faith vertical) with a **completely redesigned UI** and a first-class
**agentic trust graph**.

## What this is

- A **person** arrives, secures a home (passkey / Google / YouVersion / wallet), and
  can act as **themselves** or pin a **default organization** they custody.
- In the **person home** they manage their **vault** (PII profile, entitlements,
  delegations, stewardship links), **treasury**, **security**, and see their **trust graph**.
- As a **custodian of an organization** they manage the **org profile**, **org treasury**,
  **org security**, and the org's **service smart agents** — each exposing **skills** over A2A.
  The organization's **trust agent is itself a service smart agent**.
- The **agentic trust graph** ([React Flow](https://reactflow.dev)) visualizes the relationships
  between people, organizations, and service agents — custody, membership, stewardship,
  delegation, payment mandates, and corroborated trust **assertions** (carrying identity-match
  confidence + method, kept separate from entity trust).

## Status

- **Redesigned UI shell + trust graph** — complete; render from seed (`src/lib/seed.ts`).
- **Connect is REAL** (ported from demo-sso-next, same packages + wire protocol):
  - **Passkey** and **SIWE/wallet** run the actual WebAuthn / SIWE ceremony against the
    live `impact-a2a` relayer + the ported broker routes (`/connect/*`, `/me`, `/jwks`),
    producing a real Smart Agent + a signed `AgentSession`. See `src/lib/connect.ts` +
    `server/connect/*`.
  - **Social (Google / YouVersion)** — degrades to a "needs configuration" message until
    its OAuth client + custody-bridge env is set (below).
- **Live reads** (Network page, status chip) hit the deployed backends via the
  `/a2a` + `/mcp-bind` rewrites.
- **Still seeded** (labeled demo content): the org / vault / treasury / trust-graph
  *content* after connect — pending live-vault wiring. The connected identity itself is real.

## Required configuration (to run connect)

| Env | Needed for | How |
|-----|-----------|-----|
| `BROKER_PRIVATE_JWK` + `BROKER_KID` | passkey + SIWE (mint sessions) | `node scripts/gen-broker-key.mjs`, set both in Vercel (JWK = Sensitive) |
| `KV_REST_API_URL` + `KV_REST_API_TOKEN` | single-use nonces / challenges | attach a Vercel KV / Upstash store (local dev falls back to in-memory) |
| `GOOGLE_*`, `YOUVERSION_*`, `A2A_CUSTODY_*` | social sign-in only | provision a Google OAuth client + a custody-bridge secret matching impact-a2a |

See `.env.example`. Without `BROKER_PRIVATE_JWK` + a KV store, passkey/SIWE can't mint a
session; the bridge secret + OAuth client are only needed for Google/YouVersion.

### Social sign-in (Google / YouVersion) setup

The OIDC flow is ported (`/oidc/{google,youversion}/{start,callback}`, `/token`, the
impact-a2a custody bridge). Until configured, those buttons return a 503 "not configured".
To enable, set on the Vercel project + register the callback URLs:

- **Google** ([console.cloud.google.com](https://console.cloud.google.com) → OAuth client):
  `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (Sensitive), `GOOGLE_REDIRECT_URI` =
  `https://<your-domain>/oidc/google/callback` — register that exact URI in Google.
- **YouVersion** (public PKCE — no secret): `YOUVERSION_CLIENT_ID`,
  `YOUVERSION_REDIRECT_URI` = `https://<your-domain>/oidc/youversion/callback`.
- **Custody bridge** (so a NEW social home gets a KMS-custodied Smart Agent):
  `A2A_CUSTODY_URL` = your impact-a2a, `A2A_CUSTODY_BRIDGE_SECRET` = the value configured
  in **your** impact-a2a. Without it, social sign-in only works for a subject already
  linked to an agent (else it returns `bootstrap`).
- `DEMO_SSO_AUD` defaults to `impact` (must match the connect aud for custody-grade sessions).

## Layout

```
app/
  page.tsx              gate → entry experience or /home
  (app)/                authed shell (sidebar + context switcher + mobile nav)
    home, you, vault, treasury, security        ← person + adaptive
    organizations, organization, service-agents  ← org custodian
    trust-graph, activity                         ← adaptive
src/
  lib/types.ts          domain model (person · org · service · trust)
  lib/seed.ts           the seeded faith-community trust graph
  lib/graph.ts          builds React Flow node/edge sets per view
  context/session.tsx   identity + active context (person vs org custodian)
  components/graph/      TrustGraph (React Flow)
  components/           shell, context switcher, entry, ui primitives, icons
  whitelabel/config.ts  brand + member-facing vocabulary
```

## Develop

```bash
pnpm --filter @verifiable-content-demo/impact dev    # http://localhost:5374
pnpm --filter @verifiable-content-demo/impact typecheck
pnpm --filter @verifiable-content-demo/impact build
```

Copy `.env.example` → `.env.local` to point at specific `IMPACT_A2A_URL` / `IMPACT_MCP_URL`
deployments; the defaults target impact's own `apps/impact-a2a` / `apps/impact-mcp` workers.
