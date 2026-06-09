# Architecture — Bible Explorer (demo-bible-ontology)

How the Bible Explorer UI, the Scripture Agent (A2A), the MCP vault, and the
ontology data layer fit together — and the exact interaction flows for
**reading verse text** and **posting user feedback** on a trust signal.

## Applications & services

| Service | Where | Role | Storage |
|---|---|---|---|
| **Bible Explorer UI** (`src/ui.ts`) | Browser SPA, served by this Worker | Explore the knowledge graph, read verses, challenge trust signals, post feedback | `localStorage`: `sa.session` (connect session), `ont.imgMode` (image pref) · `sessionStorage`: `sa.pending` (PKCE state) |
| **demo-bible-ontology** (this Worker) | Cloudflare Worker, port 8795 | **Graph data layer only.** Serves the UI + static images, and `/api/*` (entities, edges, signals, scores, map, lineage, feedback thread) | D1 `bible-ontology` (node, edge, node_verse, signal, score, signal_feedback, …) |
| **demo-bible-a2a** — "Scripture Agent" | Cloudflare Worker, port 8791 | Public **agent surface** (A2A agent card + skills). The only endpoint the browser talks to for data: `/vault/*`, `/passage`, `/analyze`, `/submit-feedback`, `/resolve`, `/verify` | none (stateless; in-memory transparency log) |
| **demo-bible-mcp** — vault | Cloudflare Worker, port 8790 | MCP **tools** behind the agent: `get_passage`, `graph_query`, `submit_feedback`, `resolve`, `get_passage_text`, `get_entity`, `get_trust_signals`, … Signs credentials, gates by policy, audits | D1 `demo-bible-bsb` (full BSB verse corpus + Merkle leaf commitments + corpusRoot) |
| **demo-validator** | Vercel | Independent validator for evidence bundles (`/trust/validate` flow) | — |
| **Anthropic API** | external | LLM behind `/analyze` (Signal-Court trust audit) | — |
| **Global.Church identity** (`*.impact-agent.me`) | external | OIDC + PKCE "Connect" sign-in; JWKS-verified id_token. Required before posting feedback | — |

### Wiring

- Browser → **A2A only** for all data. The UI never calls the MCP or the
  ontology `/api` cross-origin; even this Worker's graph reads are fetched via
  `A2A_BASE + '/vault' + path`.
- A2A → MCP via a **service binding** (`MCP`, avoids CF error 1042); local dev
  falls back to `MCP_URL`.
- MCP → ontology via a **service binding** (`ONT`) — `graph_query` forwards
  allowlisted `/api/*` GET paths, `submit_feedback` POSTs to `/api/feedback`.
- Verse **text** lives only in the MCP's D1 corpus (single source of truth);
  this Worker stores verse *links* (`node_verse.osis`), never passage text.

```mermaid
flowchart LR
  B["Browser<br/>Bible Explorer UI"]
  A["demo-bible-a2a<br/>Scripture Agent"]
  M["demo-bible-mcp<br/>vault / tools"]
  O["demo-bible-ontology<br/>graph data layer"]
  D1O[("D1 bible-ontology<br/>graph + feedback")]
  D1M[("D1 demo-bible-bsb<br/>verse corpus + commitments")]
  V["demo-validator (Vercel)"]
  LLM["Anthropic API"]
  ID["Global.Church OIDC<br/>*.impact-agent.me"]

  B -- "/vault/* · /passage · /analyze<br/>/submit-feedback" --> A
  B -. "Connect (PKCE): /token, /jwks" .-> ID
  A -- "service binding MCP<br/>/tools/*" --> M
  A -- "/validate (trust flow)" --> V
  A -- "/analyze prompt" --> LLM
  M -- "service binding ONT<br/>/api/*" --> O
  O --- D1O
  M --- D1M
  O -- "serves ui.ts + /img/*" --> B
```

## Flow 1 — Getting verse data

User clicks a verse reference chip (e.g. `1Chr.11.14`) on an entity page →
`openPassage(osis)` opens the popup and fetches a chapter-clamped window of
verses around the citation.

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant UI as Bible Explorer UI (browser)
  participant A2A as demo-bible-a2a (Scripture Agent)
  participant MCP as demo-bible-mcp (vault)
  participant DB as D1 demo-bible-bsb

  U->>UI: click verse ref (osis)
  UI->>A2A: GET /passage?osis=1Chr.11.14
  A2A->>MCP: POST /tools/get_passage {osis} (service binding)
  MCP->>MCP: policyGate('get_passage') → allow
  MCP->>DB: find leaf_index of osis, clamp ±5 to chapter bounds
  DB-->>MCP: verses [{osis, text} …]
  MCP->>MCP: audit('vault.get_passage')
  MCP-->>A2A: { ok, osis, edition, verses }
  A2A-->>UI: passthrough JSON
  UI-->>U: popup — cited verse highlighted in context
```

Notes:
- Graph reads (which entities cite which verses) follow the same path through
  the agent: `UI → A2A GET /vault/node/David → MCP /tools/graph_query
  {path:'/api/node/David'} → ONT binding → this Worker's D1`.
- The separate *verifiable* path (`/resolve`) adds entitlement gating, Merkle
  commitment verification, and a signed `CitationAssertion`; `/passage` is the
  lightweight read-in-context path used by this UI.

## Flow 2 — Posting feedback on a trust signal

From the **Signal Court** modal: the user must be *connected* (Global.Church
OIDC + PKCE), can optionally run the AI audit (`/analyze`), then posts a
stance (agree / challenge / note). The MCP mints a **signed
`TrustSignalFeedback` verifiable credential** and persists it into this
Worker's public feedback thread.

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant UI as Bible Explorer UI (browser)
  participant ID as Global.Church OIDC
  participant A2A as demo-bible-a2a (Scripture Agent)
  participant LLM as Anthropic API
  participant MCP as demo-bible-mcp (vault)
  participant ONT as demo-bible-ontology
  participant DB as D1 bible-ontology

  rect rgb(245,245,245)
    note over U,ID: Connect (once per session)
    U->>UI: Connect
    UI->>ID: authorize (PKCE: code_challenge, state, nonce)
    ID-->>UI: redirect with code
    UI->>ID: POST /token (code + verifier) · GET /jwks
    UI->>UI: verify id_token (iss/aud/nonce) → save sa.session in localStorage
  end

  rect rgb(245,245,245)
    note over U,LLM: Optional AI audit of the signal
    U->>UI: "Challenge signal"
    UI->>A2A: POST /analyze {subject_label, sig_kind, basis, osis}
    A2A->>LLM: scoped prompt (verse-in-context check)
    LLM-->>A2A: analysis markdown
    A2A-->>UI: { analysis } → UI derives verdict (valid/adjust/invalid)
  end

  U->>UI: post stance + comment
  UI->>A2A: POST /submit-feedback {target(entity,signal,verse), stance, verdict, comment, agentRationale, proposedCorrection, author(session.sub)}
  A2A->>MCP: POST /tools/submit_feedback (service binding)
  MCP->>MCP: policyGate → allow · require author.agentId + comment
  MCP->>MCP: sign TrustSignalFeedback VC (issuer did:ap:scripture-agent)
  MCP->>ONT: POST /api/feedback (ONT binding) — fields + signed assertion
  ONT->>DB: INSERT INTO signal_feedback
  ONT-->>MCP: { ok }
  MCP->>MCP: audit('vault.submit_feedback')
  MCP-->>A2A: { ok, assertion }
  A2A-->>UI: { ok, assertion }
  UI-->>U: "✓ Posted — your signed feedback assertion was recorded"
```

The feedback thread is read back through the same agent path:
`UI → A2A /vault/feedback?subject=…&basis=… → MCP graph_query →
GET /api/feedback` (rows flagged `signed` when an assertion is attached).
