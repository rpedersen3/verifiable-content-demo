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

## Status (phase 1)

The **redesigned UI shell + trust graph** are complete and render from realistic seed
data (`src/lib/seed.ts`). Sign-in and all ceremonies (delegation signing, vault
read/write, KMS custody, x402) are **stubbed behind clean seams** (`src/context/session.tsx`).

The next phase wires those seams to the **live agenticprimitives backends** — `demo-a2a`
and `demo-mcp` — via the same-origin rewrites in `next.config.mjs` (`/a2a/*`, `/mcp-bind/*`),
exactly as `demo-sso-next` does.

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

Copy `.env.example` → `.env.local` to point at specific `DEMO_A2A_URL` / `DEMO_MCP_URL`
deployments; the defaults target the live workers used by `demo-sso-next`.
