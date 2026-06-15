# Requirements — Async, Delegation-Authorized A2A (platform / agenticprimitives)

**Audience:** the agenticprimitives platform developer.
**Goal:** implement the async Agent-to-Agent (A2A) **task transport** that spec 245 designs
but the platform has not built yet, as a reusable platform primitive. After this, any *claimed*
agent can send any other claimed agent an **asynchronous, delegation-authorized task**, and pick
up the result by **poll, push, or stream**. The first consumer is the verifiable-content-demo
"Scripture Agent" ↔ "BSB Corpus-Manager" entitlement conversation, but nothing here is
scripture-specific.

**Aggressive stance (agreed):** no migration constraints, full write access to the platform.
Build the *right* thing as a first-class primitive — do **not** bolt it onto a single consumer.

---

## 0. Current state (what exists — reuse, don't rebuild)

- **Task/Message/Artifact TYPES** live in `packages/fulfillment/src/index.ts`: `TaskState`
  (`submitted|working|input-required|completed|failed|canceled|rejected|auth-required`),
  `TASK_TRANSITIONS` + `canTaskTransition(from,to)`, `Task{ taskId, parentCaseId?,
  parentIntentId?, state, assignee, assigneeKind, inputHash, artifactIds[], deadline?,
  maxRetries, permissionGrantRef }`, `HandoffPolicy` + `isHandoffAllowed(...)`. **No runtime,
  no transport, no storage.** ← build the runtime on these types.
- **Delegation primitive (live, proven):** envelope `{ delegator, delegate, authority,
  caveats[], salt, signature }`; `verifyDelegation` (`apps/demo-a2a/src/index.ts:2863`) checks
  `delegate===requester`, timestamp caveat, **on-chain `isRevoked` fail-closed**, ERC-1271
  `isValidSignature` (magic `0x1626ba7e`); `hashDelegation` (canonical digest, **excludes args**).
- **Deployed caveat enforcers** (Base Sepolia, from demo-web-pro env): `timestampEnforcer`,
  `valueEnforcer`, **`allowedTargetsEnforcer`, `allowedMethodsEnforcer`**, `delegationManager`,
  `universalSignatureValidator`. ← the target/method scoping below **reuses the existing
  allowed-targets / allowed-methods enforcers**; do not invent new ones.
- **DO template:** `apps/demo-a2a/src/session-store-do.ts` (`SessionStoreDO`, sharded
  `idFromName(...)`, alarm-capable). ← template for `TaskStoreDO`.
- **Agent identity/routing:** `host-context.ts` resolves `<handle>.impact-agent.io` → name →
  `AgentNamingClient.resolveName` → on-chain SA; agent-card at `/.well-known/agent-card.json`.
- **A2A surface today:** JSON-RPC 2.0 at `POST /api/a2a` with only a stub `message/send`
  (`apps/demo-a2a/src/index.ts:648`). Everything below replaces the stub with the real thing.
- **a2a→mcp leg (reuse for delivery):** `callMcpToolViaDelegation` + `mintDelegationToken`
  + service-MAC (`generateServiceMac`/`A2A_MAC_SECRET`); receiving side `withDelegation`
  (`packages/mcp-runtime`) keys records by `principal = delegation.delegator`.

---

## 1. Deliverables

1. **`@agenticprimitives/a2a`** — a new package: the spec-245 Task/Message/Artifact **runtime**
   (create/store/transition/retrieve), the **`A2aWireAdapter`** (client), the JSON-RPC
   **method handlers** (server), and a **pluggable skill-handler interface**. Built on
   `@agenticprimitives/fulfillment` types. **Embeddable**: any agent worker imports it to expose
   a compliant async A2A surface — this is what makes it a primitive, not a one-off.
2. **`TaskStoreDO`** — a Durable Object (per-agent task mailbox) the package provides, driven by
   `alarm()`, persisting tasks/messages/artifacts; bodies are **VaultRefs**, never inline on-chain.
3. **Relayer adoption** — `apps/demo-a2a` wires the real JSON-RPC methods to the package +
   `TaskStoreDO`, with delegation auth at the door, replacing the stub.
4. **Caveat enforcement in the A2A auth path** — enforce `allowedTargetsEnforcer` +
   `allowedMethodsEnforcer` caveats (in addition to timestamp) so a grant is scoped to a
   *specific recipient agent + skill*. Closes the "possession = authority" gap.
5. **A test agent + harness** (the test project you offered) — two embedded agents exchanging an
   async, delegation-authorized task end-to-end (see §7 acceptance).

---

## 2. Functional requirements — JSON-RPC method surface (`POST /api/a2a`)

JSON-RPC 2.0; agent resolved from Host (existing `host-context`). Implement:

- **`message/send`** (async submit). `params`: `{ delegation, requester, skill, threadId?,
  input, pushConfig? }`.
  - FR-2.1 Verify the delegation **before** creating anything (see §4). Reject → JSON-RPC error.
  - FR-2.2 Persist the inbound **Message** (`bodyRef` = vault write of `input`, `bodyHash`,
    `sender`, `signature`) and create a **Task** `{ state:'submitted', assignee: <this agent SA>,
    inputHash, permissionGrantRef: hashDelegation(delegation) }`.
  - FR-2.3 **Return immediately** `{ taskId, state:'submitted' }` (do NOT run the skill inline).
  - FR-2.4 Schedule processing via `TaskStoreDO.alarm()`.
- **`tasks/get`** `params:{ taskId }` → the Task (state, artifactIds, error?). Auth: caller must
  be the task's `sender` or `assignee` (verify via delegation/session). The **poll** path.
- **`tasks/cancel`** `params:{ taskId }` → transition to `canceled` if `canTaskTransition`.
- **`message/stream`** (SSE) — subscribe to a task's state/artifact updates as an
  `AsyncIterable` (the `A2aWireAdapter.subscribeTaskUpdates`). The **stream** path.
- **`tasks/pushNotificationConfig/set`** `params:{ taskId, url, token? }` — register a webhook;
  on terminal state the agent POSTs a **signed** push to `url` (see §5). The **push** path.

`capabilities` in the agent-card flips to `{ streaming:true, pushNotifications:true,
stateTransitionHistory:true }`.

---

## 3. Functional requirements — Task runtime, storage, skill handlers

- FR-3.1 **`TaskStoreDO`**: shard `idFromName(assigneeSA.toLowerCase())` = one mailbox per agent.
  Store tasks, inbound/outbound messages, artifacts (artifact *bodies* as VaultRefs). Persist
  enough to answer `tasks/get` and resume after eviction.
- FR-3.2 **Processing** runs in `alarm()` (never blocks the HTTP request): `submitted → working
  → (completed | failed | input-required)`, gated by `canTaskTransition`. Respect `maxRetries`,
  `deadline`.
- FR-3.3 **Skill-handler interface** (the consumer plug-in — the most important API for us):
  ```ts
  interface SkillHandler {
    skill: string;                       // e.g. 'request-entitlement'
    // principal = delegation.delegator (on whose behalf the sender acts)
    handle(ctx: {
      taskId: string; principal: Address; sender: Address;
      input: unknown; delegation: DelegationWire;   // the verified, captured grant
      vault: VaultClient;                            // read/write records (uses delegation)
      mcp: McpClient;                                // call tools via the delegation token
      emitArtifact(a: Artifact): Promise<void>;
      requestAuth(reason: string): never;            // -> task 'auth-required'
    }): Promise<{ state: 'completed'|'failed'|'input-required'; artifactIds?: string[]; error?: string }>;
  }
  ```
  An agent registers handlers: `createA2aAgent({ agentSA, signer, handlers: [...] })`. The DO
  dispatches by `skill`. **Unknown skill → `rejected`.**
- FR-3.4 The handler can **deliver results into another principal's vault** by presenting a
  delegation that principal granted (e.g. write an entitlement VC into the *reader's* demo-mcp
  namespace using the reader's captured delegation) — reuse the `callMcpToolViaDelegation` path.
- FR-3.5 **`auth-required` loop**: a handler may suspend a task pending a fresh/again-scoped
  delegation; resubmission (`auth-required → submitted`) carries the new grant. (spec 245 §4.)
- FR-3.6 **Hand-off**: a handler may reassign a task to another agent only if
  `isHandoffAllowed(handoffPolicy, target, class)`; the new assignee re-verifies the (possibly
  re-scoped) delegation.

---

## 4. Functional requirements — delegation authorization on the A2A message path

This is net-new (today's `verifyDelegation` guards the **vault**, not agent endpoints).

- FR-4.1 Reuse `verifyDelegation` verbatim for: `delegate===requester`, timestamp window,
  **on-chain `isRevoked` fail-closed**, ERC-1271 signature. The principal the sender acts for is
  `delegation.delegator`.
- FR-4.2 **Enforce the recipient/skill caveats** (NEW): the delegation MUST carry an
  `allowedTargetsEnforcer` caveat naming **this agent's SA** and an `allowedMethodsEnforcer`
  caveat naming the **requested skill** (or a documented "any" sentinel). Reject otherwise. This
  is what makes a grant non-replayable against a different agent/skill. Enforce these in the A2A
  path even though the legacy vault path checks only timestamp.
- FR-4.3 **Replay protection on the A2A method**: a per-agent single-use nonce store
  (JTI/message-id) — the existing service-MAC JTI store covers only the a2a→mcp leg; the inbound
  A2A `message/send` needs its own. Bind to `messageId` + short skew window.
- FR-4.4 **Signed messages (A2A-INV-01)**: inbound `Message.signature` is verified against the
  `sender`; outbound artifacts/pushes are signed by the **assignee SA** (KMS/session key).
- FR-4.5 **Bodies in the vault (A2A-INV-04)**: message/artifact bodies are vault records
  (`bodyRef`), never embedded on-chain; only hashes/refs travel in task state.
- FR-4.6 **`Task.permissionGrantRef = hashDelegation(delegation)`** — every task is auditably
  bound to the grant that authorized it; revoking that delegation (on-chain `isRevoked`) must
  cause in-flight processing and any re-auth to fail closed.

---

## 5. Delivery (poll / push / stream)

- FR-5.1 **Poll**: `tasks/get` returns current state + `artifactIds`; the sender fetches artifact
  bodies from the vault by ref.
- FR-5.2 **Push**: on terminal state, POST to the registered `url` a **signed** payload
  `{ taskId, state, artifactIds, sig }` signed by the assignee SA; include the `token` the sender
  registered; best-effort with bounded retry. Receiver verifies the signature.
- FR-5.3 **Stream**: `message/stream` SSE emits `task.status` + `task.artifact` events until a
  terminal state. The `A2aWireAdapter.subscribeTaskUpdates` yields these.

---

## 6. Security requirements (fail-closed everywhere)

- SR-1 Verify delegation **before** task creation; never create a task for an unverifiable grant.
- SR-2 On-chain `isRevoked` checked **before** trusting the signature (already the pattern).
- SR-3 Recipient + skill caveats enforced (FR-4.2) — no cross-agent / cross-skill replay.
- SR-4 Inbound-message replay nonce store (FR-4.3).
- SR-5 Signed outbound artifacts/pushes (FR-4.4) — downstream independently verifiable.
- SR-6 Authorization ≠ identity: a valid token proves *who*; the caveats + `assignee` decide
  *what*. A delegator can never reach another principal's namespace (`withDelegation` invariant).
- SR-7 Parameterized storage only; bodies vault-only (FR-4.5).
- SR-8 KMS/session signing keys are the only signing material; no long-lived private key for a
  claimed agent in any worker.

---

## 7. Acceptance criteria + the test project

- **AC-1 Echo task (smoke):** agent B registers an `echo` handler; agent A
  `A2aWireAdapter.submitTask(B, { skill:'echo', input, delegation })` → `{taskId,'submitted'}`
  immediately; B processes async; A's `tasks/get` returns `completed` + an artifact echoing
  `input`. Also passes via `message/stream` and via a registered push webhook.
- **AC-2 Delegation gate:** the same call with (a) an expired delegation, (b) a delegation whose
  `allowedTargets` ≠ B, (c) a revoked delegation, (d) wrong `skill` vs `allowedMethods` — each is
  **rejected**, no task created.
- **AC-3 Canonical entitlement conversation (the real test project):**
  1. reader-agent → `bsb` agent `message/send{ skill:'request-entitlement', input:{edition},
     delegation:(reader→bsb, targets=bsb, methods=request-entitlement) }` → `submitted`.
  2. The `request-entitlement` handler creates a pending request artifact (owner approval is
     out-of-band; model approval as a second task or an admin call that flips the task to
     `working`).
  3. On approval, the handler **signs an Entitlement VC** and **writes it into the reader's
     demo-mcp vault** (using the reader's captured delegation) → task `completed` with the VC
     artifact ref.
  4. reader-agent receives completion (poll/push) and finds the VC in its own vault.
- **AC-4 `auth-required` round-trip:** a handler suspends on an expired grant; resubmission with a
  fresh grant resumes (`auth-required → submitted → completed`).

A standalone test project with **two embedded agents** (using `@agenticprimitives/a2a`) and a
scripted run of AC-1..AC-4 is the deliverable that proves the primitive before we consume it.

---

## 8. The consumer-facing contract (what verifiable-content-demo will rely on)

So our side can build against a stable surface, the package MUST export:
- `createA2aAgent({ agentSA, signer, handlers, vault, mcp })` → an embeddable handler for an
  agent worker's `/api/a2a` + the `TaskStoreDO` binding + agent-card builder.
- `A2aWireAdapter` client: `submitTask(targetAgent, { skill, input, delegation, pushConfig? })`,
  `getTask(taskId)`, `subscribeTaskUpdates(taskId)`, `cancelTask(taskId)`.
- Delegation builders that attach the **allowed-targets (recipient agent SA)** and
  **allowed-methods (skill)** caveats, so callers mint correctly-scoped grants.
- Types re-exported from `fulfillment` (`Task`, `TaskState`, `Artifact`, `Message`).
- Agent discovery: resolve `targetAgent` (name → SA → endpoint) + fetch its agent-card/skills.

Our agents (`scripture-resolver.impact`, `bsb.impact`) will each `createA2aAgent(...)`, register
skills (`request-entitlement`, `resolve-on-behalf`, `deliver-entitlement`, …), and call each
other (and reader agents call them) via `A2aWireAdapter`.

---

## 9. Open decisions for the platform team

1. **Embedded-per-agent vs shared-relayer dispatch.** Strong recommendation: the package is
   **embeddable** so each agent worker runs its own task runtime/DO (sovereign agents). The
   shared `*.impact-agent.io` relayer becomes one consumer of the package (for agents without
   their own worker) and/or a **dispatcher** that forwards a verified task to the agent's
   registered skill-execution backend. Decide the dispatch contract if you keep the single
   relayer.
2. **Artifact/message vault** — which vault holds A2A bodies (the per-agent demo-mcp vault under
   the assignee's namespace?) and the `VaultRef` format.
3. **Push security** — exact signed-push envelope + replay/idempotency on the receiver.
4. **allowed-targets/allowed-methods caveat encoding** — confirm the existing enforcers' term
   encoding so our delegation builders match (so a reader can mint `reader → bsb, targets=[bsbSA],
   methods=['request-entitlement']`).
5. **On-chain vs off-chain caveat check at message/send** — enforce via the deployed enforcer
   semantics (decode terms + check) off-chain in the verify path (cheap) vs an on-chain call;
   recommend off-chain decode matching the enforcer, with on-chain `isRevoked` staying authoritative.

---

*Companion docs in this repo:
[`corpus-ownership-and-entitlements.md`](./corpus-ownership-and-entitlements.md)
defines the corpus-owner/KMS plan and request/grant/deliver entitlement flow, and
[`corpus-entitlements-consumer-spec.md`](./corpus-entitlements-consumer-spec.md)
maps that flow into this repo. The A2A transport here is the bus those flows ride.*
