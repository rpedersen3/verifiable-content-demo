# Consumer-side spec — Corpus ownership, entitlements & our agents on the A2A bus

**Repo:** verifiable-content-demo. **Companion to:** `docs/a2a-platform-requirements.md` (the
platform `@agenticprimitives/a2a` async transport) — this doc is the half **we** build, consuming
that primitive. Locked decisions referenced here: entitlements are written into the **reader's own
demo-mcp vault at grant time** (capture the reader's delegation at request time); the BSB ledger is
demoted to revocation/audit; aggressive/best architecture (claim our agents on-chain, KMS delegate
registered as an ERC-1271 scoped signer, no migration constraints).

---

## 0. Actors & where they run

| Actor / surface | Worker (this repo) | Identity | Role |
|---|---|---|---|
| **BSB Corpus-Manager agent** | `demo-bible-mcp` (BSB archive + vault + issuer) — add an `/api/a2a` surface via `createA2aAgent` | claimed `bsb.impact` (owner-controlled, KMS delegate) | owns corpus; issues + delivers entitlements; serves gated verse text; vault |
| **Scripture Agent** | `demo-bible-a2a` (already the agent-card holder) | claimed `scripture-resolver.impact` (its own KMS key) | public front door; orchestrates resolve → entitle-check → text → verify → cite; talks to BSB on a reader's behalf |
| **Reader agent** | the reader's app acts as client (`A2aWireAdapter`) | reader's canonical agent id from their home id_token (named or `www.impact-agent.me`) | requests entitlements; reads gated verses |
| **Owner (corpus admin)** | `demo-corpus` (NEW admin Worker+SPA, 8796) | connected user who claims `bsb.impact` | claim ceremony; approve/deny/revoke entitlements; curation |
| **Reader consumer UIs** | `demo-bible-ontology` (Bible Explorer), `demo-bible-web` | browser `sa.session` | where readers actually request + read |
| Data | D1 `demo-bible-bsb` (corpus/verses/claims/entitlements), D1 `bible-ontology` (graph) | — | — |

Two A2A agents (`bsb.impact`, `scripture-resolver.impact`), each `createA2aAgent(...)` with its
own KMS signer + `TaskStoreDO`. Everything inter-agent goes over the A2A bus from the platform doc.

---

## 1. Ownership — claiming `bsb.impact` (consumer side of Flow A)

- **CR-1 `service_identity` table** (D1 `demo-bible-bsb`): `{ service, issuer_agent_id, owner_sub,
  delegate_address, delegation, scoped_signer_tx?, created_at }`. One row per claimed service
  (`bsb-archive`, `scripture-agent`). First-claim-wins, pinned to `ISSUER_AGENT_ID`.
- **CR-2 `demo-corpus` claim endpoints:** `GET /admin/service-key?service=` → derive `0xKMS`
  from KMS pubkey; the claim ceremony (OIDC PKCE at `bsb.impact-agent.me`, `delegate=0xKMS`,
  `delegation_template=corpus-issuer`) → `POST /admin/claim { service, id_token, delegation }`;
  server-side verify id_token vs the home JWKS; write `service_identity`.
- **CR-3 KMS delegate as on-chain ERC-1271 scoped signer (aggressive endgame, §6.2):** at claim,
  the owner's home registers `0xKMS` as a scoped signer on the `bsb.impact` AgentAccount (one
  relayed tx); verifiers then use `isValidSignature` — eliminates fabricated-delegation risk by
  construction. (Fallback baseline: JWKS-verified off-chain delegation, finding #1.)
- **CR-4 `claimed` trust mode in `demo-bible-mcp`** (new mode in `lib/trust-context.ts` beside
  `dev`/`onchain`): issuer DID = `bsb.impact`; sign via **`KmsSigner`** (`asymmetricSign`,
  secp256k1); **embed + cryptographically verify the owner delegation at load** (fail closed if
  it doesn't verify, finding #1/#7). Scripture Agent claimed the same way (`scripture-agent`
  service, its own KMS key); reads its claim at cold start via service binding.
- **CR-5** No private key for `bsb.impact` anywhere in this repo. Disable the KMS key or delete
  the claim → corpus instantly orphaned; owner loses nothing.

**External prereqs (your side):** a GCP project + SA creds + two `EC_SIGN_SECP256K1_SHA256` keys
(MCP + A2A, `cloudkms.signer` only); `bsb.impact` registered to the owner at their home; the home
supporting the `corpus-issuer` delegation template; `ISSUER_AGENT_ID` pin set as a wrangler var;
`aud='demo-corpus'` + demo-corpus origin allow-listed on the homes.

---

## 2. Our agents' A2A skills (the `SkillHandler`s we register)

Each handler signature follows the platform §3.3 `SkillHandler`. `principal = delegation.delegator`
(on whose behalf the caller acts). Delegations MUST carry `allowed-targets` (the recipient agent
SA) + `allowed-methods` (the skill) caveats (platform FR-4.2).

**BSB Corpus-Manager (`bsb.impact`, on `demo-bible-mcp`):**
- `request-entitlement` — `input:{ edition }`, auth: reader's delegation (targets=bsb,
  methods=request-entitlement). Effect: persist `entitlement_requests(subject=principal, edition,
  status=pending)` **and capture the reader's delegation** on the row. Returns task `submitted`
  (owner approval is out-of-band; see §3). Artifact: `{ requestId }`.
- `issue-entitlement` — owner-gated, invoked by `demo-corpus` on approval (auth: owner session,
  not a reader delegation): sign the Entitlement VC (KMS), **deliver into the reader's demo-mcp
  vault** (§3), write `entitlements_issued`, flip the request → granted. Artifact: the VC ref.
- `revoke-entitlement` — owner-gated: flip `entitlements_issued.status=revoked`. (Online
  revocation: gated reads re-check this row.)
- `get-gated-passage` — `input:{ reference, edition, entitlementRef }`, auth: reader's
  delegation. Effect: `verifySignedEntitlement` + `evaluateEntitlement` + **presenter-binding**
  (`principal == credentialSubject.id`) + online-revocation check → return verse text + commitment.
- `resolve` — candidate descriptors/commitments for a reference (issuer `bsb.impact`).

**Scripture Agent (`scripture-resolver.impact`, on `demo-bible-a2a`):**
- `resolve-passage`, `character-trust-profile`, `find-entities`, `entity-graph`,
  `challenge-signal`, `signal-feedback` — the existing skills, exposed as A2A tasks (reads may
  stay synchronous internally but are addressable as skills).
- `resolve-on-behalf` — `input:{ reference, edition }`, auth: reader's delegation. Orchestrates:
  → BSB `resolve` → BSB `get-gated-passage` (**re-presenting the reader's delegation**, scoped
  targets=bsb) → `verifyCommitment(text, descriptor)` → **sign a `CitationAssertion` with the
  Scripture Agent's KMS key** → return `{ text, commitmentVerified, citation, entitlementStatus }`.
- `request-entitlement` — thin proxy to BSB `request-entitlement` (so the reader has one front
  door); or readers may call BSB directly. (Decision §8.)

---

## 3. The entitlement lifecycle as an A2A conversation (the canonical flow)

This realizes platform AC-3 and the locked vault decision. **Subjects are never typed by hand** —
they come from the verified id_token (`principal`).

```
REQUEST (reader present)
  reader app → Scripture Agent or BSB: message/send
     skill=request-entitlement, input={edition},
     delegation = reader→bsb  (targets=[bsbSA], methods=[request-entitlement], timestamp)
  BSB request-entitlement handler:
     verify delegation (platform) → INSERT entitlement_requests(subject=principal, edition,
        status=pending, reader_delegation=<captured wire>)         ← capture for right-away delivery
     task → submitted; artifact {requestId}

APPROVE (owner, out-of-band, demo-corpus)
  owner (session.sub == service_identity.owner_sub) clicks Approve(TTL)
  demo-corpus → BSB issue-entitlement { edition, subject, ttl }
  BSB issue-entitlement handler:
     sign Entitlement VC (KMS): issuer=bsb.impact,
        credentialSubject={ id: subject, corpusRef, accessPolicy }, validUntil=now+ttl
     DELIVER RIGHT AWAY: set_vault_record via the relayer using the CAPTURED reader delegation
        → recordType "entitlement:bsb:<edition>", data = signed VC   ← lands in the READER's vault
     INSERT entitlements_issued(request_id, edition, subject, issued_by_sub, valid_until,
        status=granted)                                              ← ledger = revocation/audit only
     flip request → granted; complete the reader's task (push/poll)
  (Fallback: if the captured delegation expired before approval → deliver on the reader's next
   connect; UI shows "delivered ✓ / will deliver on next sign-in".)

READ (reader, later)
  reader app: read OWN vault get_vault_record "entitlement:bsb:<edition>" → the VC
  reader app → Scripture Agent: resolve-on-behalf { reference, edition }, delegation reader→scripture
  Scripture Agent → BSB get-gated-passage { reference, edition, entitlementRef }, delegation reader→bsb
  BSB: verifySignedEntitlement (sig recovers 0xKMS) + delegation chain (bsb→0xKMS) +
       evaluateEntitlement (subject==principal, corpusRef, not expired) + online-revocation
       → verse text + commitment   (FAIL-CLOSED on any check)
  Scripture Agent: verifyCommitment → sign CitationAssertion → return to reader app → rendered
```

- **CONV-1** The request, the grant-delivery, and the completion notification are **A2A tasks** on
  the platform bus; auth is the **delegation envelope**, scoped by target+method caveats.
- **CONV-2** The **reader's demo-mcp vault is the canonical store** of the entitlement; the BSB
  `entitlements_issued` row exists only for **revocation + audit** (serve-time "still granted?").
- **CONV-3** Capturing the reader's delegation at request time is what makes delivery **immediate**
  at grant time even though the reader is offline.

---

## 4. `demo-corpus` — the owner/admin app (NEW, port 8796)

- **DC-1** Hono Worker + inline SPA; D1 bindings to **both** `demo-bible-bsb` and `bible-ontology`;
  service binding to `demo-bible-mcp` (BSB agent) for issue/revoke.
- **DC-2** OIDC relying-app (reuse the Explorer's connect-client; `client_id='demo-corpus'`,
  `aud='demo-corpus'`); after one server-side id_token verification, issue **its own HttpOnly
  session cookie + CSRF** (finding #5); id_token never re-sent. Strict CSP, zero third-party
  scripts (finding #5).
- **DC-3 Tabs:**
  - **Identity** — corpus claim ceremony (Flow A); shows claim status, `0xKMS`, owner sub.
  - **Entitlements** — **Requests queue** (badge = pending count) → Approve(TTL)/Deny(reason);
    **Issued ledger** (revoke); manual grant as a secondary affordance.
  - **Curation** (migrated from the Explorer Admin) — data-integrity review + the
    signal-correction queue (the challenge verdicts → apply corrections to
    `trust-signals-generated.json`). Explorer becomes pure consumer.
- **DC-4 Authz:** every write requires `session.sub == service_identity.owner_sub` (finding #9);
  read-only browsing may be looser. Parameterized SQL only (finding #10).

---

## 5. Reader/consumer UIs (`demo-bible-ontology` Explorer + `demo-bible-web`)

- **RU-1 Request access** — a "Request access to <edition>" action → A2A `request-entitlement`
  (carries the reader's connect-delegation, scoped to BSB).
- **RU-2 My access** — reads the reader's **own demo-mcp vault** for held entitlement VCs (reuse
  the Admin "My account" vault path we already wired) + `GET /my-requests` for pending/granted/
  denied status.
- **RU-3 Entitled read** — for a gated edition, attach the held VC: route through Scripture Agent
  `resolve-on-behalf` (not the public `get_passage`); render verse text + the provenance/trust card
  (commitmentVerified + CitationAssertion + entitlement status).
- **RU-4 Accept-on-connect fallback** — if a grant arrived while offline and the captured
  delegation had expired, write it into the reader's vault on this connect.
- **RU-5** Public BSB stays open (no entitlement); only licensed editions (`demo-licensed`) are
  gated — that's where the whole flow is demonstrated.

---

## 6. D1 schema (D1 `demo-bible-bsb`) — new tables

- `service_identity(service PK, issuer_agent_id, owner_sub, delegate_address, delegation JSON,
  scoped_signer_tx, created_at)`
- `entitlement_requests(id PK, subject, subject_name, edition, note, status, reader_delegation
  JSON, created_at, decided_at, decided_by_sub)`  — status ∈ pending|granted|denied
- `entitlements_issued(id PK, request_id, edition, subject, issued_by_sub, entitlement JSON,
  valid_until, status, created_at)` — status ∈ granted|revoked  (ledger = revocation/audit)
- A2A task/message/artifact storage is the platform's `TaskStoreDO` (NOT these tables).

The **canonical entitlement copy** is the VC in the reader's demo-mcp vault, NOT these rows.

---

## 7. Security & data-integrity (our side; maps the design's §6 findings)

- **Presenter-binding** (finding #4): `get-gated-passage` enforces `principal == credentialSubject.id`.
- **Online revocation** (finding #8): gated reads re-check `entitlements_issued.status='granted'`.
- **Owner-only writes** (finding #9): all issue/revoke/curation gated on `owner_sub`.
- **Verified stored delegation** (finding #1/#7): MCP re-verifies `service_identity.delegation`
  at load; D1 rows are never trusted as authority — the VC/delegation inside must still verify.
- **iss allowlist + aud + single-use nonce** (finding #3) on every id_token check.
- **ISSUER_AGENT_ID pin** (finding #2) on claim.
- **Parameterized SQL** everywhere new (finding #10); the existing `book`-into-LIKE interpolation
  is not copied.
- **Data-integrity rules (CLAUDE.md):** entitlements/claims carry their method + confidence where
  relevant; suspect bindings stay visible; licensing travels with edition records.

---

## 8. Open decisions (consumer side)

1. **Front door:** do readers call the **Scripture Agent** for everything (it proxies to BSB), or
   talk to **BSB directly** for `request-entitlement`? (Recommend Scripture Agent as the single
   public front door; BSB is reachable agent-to-agent only.)
2. **Curation migration:** move the Explorer Admin's data-integrity + signal-correction queue into
   `demo-corpus` now (Explorer becomes read-only consumer), or keep dual during build?
3. **Reads as tasks vs sync:** keep simple reads (`character-trust-profile`, public `get_passage`)
   synchronous and reserve the async task bus for the multi-step conversations (entitlement,
   resolve-on-behalf), or model everything as tasks for uniformity?
4. **Scripture Agent KMS:** its own KMS key + claim now, or run it on the `dev` signer until the
   BSB claim path is proven, then claim it?

---

## 9. Build phases (consumer side) & dependency on the platform deliverable

- **P0 (no platform dep):** `claimed` trust mode + KMS signer in `demo-bible-mcp`; the claim
  ceremony + `service_identity`; `demo-corpus` scaffold (OIDC session, tabs). Sign with KMS as
  `bsb.impact`.
- **P1 (no platform dep — sync first):** entitlement lifecycle over **HTTP** (request rows,
  owner approve, sign VC, **deliver into the reader's demo-mcp vault**, gated read with
  presenter-binding + revocation). Proves the *business logic* without the async bus.
- **P2 (needs `@agenticprimitives/a2a`):** lift the conversations onto the **A2A task bus** —
  `createA2aAgent` on `demo-bible-mcp` (`bsb.impact`) + `demo-bible-a2a`
  (`scripture-resolver.impact`); skills as `SkillHandler`s; reader app uses `A2aWireAdapter`;
  scoped delegations (target+method caveats). Swap P1's HTTP calls for async tasks.
- **P3:** on-chain ERC-1271 scoped-signer registration (CR-3); push/stream delivery; curation
  migration; harden.

P0/P1 can proceed **in parallel** with the platform team building the bus; P2 consumes their
`@agenticprimitives/a2a` per the §8 contract in the platform doc.

---

*Pairs with `docs/a2a-platform-requirements.md` (the bus) — together they are the full contract:
the platform builds the async delegation-authorized A2A transport; this repo builds the claimed
agents, the corpus-ownership/KMS claim, and the entitlement conversation that rides it.*
