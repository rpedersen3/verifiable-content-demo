# x402 Pay-Per-Use for Licensed Scripture (lbsb) — Platform Requirements

Requirements for the **agenticprimitives packages + contracts** to support a per-use **x402** payment
when a connected user accesses the **licensed BSB (lbsb)** scripture A2A service from the Bible
Explorer. Companion to `docs/a2a-platform-requirements.md` / `docs/corpus-entitlements-consumer-spec.md`.

> Consumer side (this repo) is sketched in §6; this doc is what the **platform** repo must build.

---

## 1. Goal

A connected reader who calls the **lbsb scripture service agent** pays a small **x402 fee per access**;
the fee moves **from the user's agent wallet → the lbsb treasury agent wallet**. No fee, no content.

This is **pay-per-use**, complementary to (and independently usable from) the existing grant-based
**entitlement** model — either can gate lbsb. (Decision D1: pay-per-use replaces, augments, or
prepays-an-entitlement — see §7.)

## 2. Actors, wallets, asset

| Actor | Identity | Wallet | Role |
|---|---|---|---|
| **Reader** | the connected user's agent | user Smart Account (payer) | pays the fee |
| **lbsb scripture service** | `lbsb-scripture.impact` (custodied by `lbsb.impact`) | service SA | charges + serves content |
| **lbsb treasury** | `lbsb-treasury.impact` (custodied by `lbsb.impact`) | treasury SA (**payee**) | receives fees |
| Fee asset | test **USDC** on **Base Sepolia** (chain 84532) | — | unit of account |

`lbsb.impact` custodies **both** service agents (already resolvable via agent-naming, like
`bsb.impact`/`lbsb.impact`). Both are `AgentAccount`s.

## 3. The x402 exchange (per access)

```
Explorer → lbsb A2A scripture skill (GET passage / graph under lbsb)
   ← 402 Payment Required  + PaymentRequirements{ payTo=treasurySA, asset=USDC, maxAmount, network,
                                                  resource{method,url,bodyHash}, nonce, expiresAt }
Reader's agent → builds a PaymentMandate (mode=closed, contextBinding=that resource) authorized by the
                 reader's PAYMENT DELEGATION (minted at connect), signs/attaches it as X-PAYMENT
Explorer → retry with X-PAYMENT
   lbsb A2A → x402 rail executor: verifyMandate → executeRedemption (settle on-chain: user SA → treasury
              SA, USDC, capped by the payment enforcer) → receipt{settlementHash}
   ← 200 + content + X-PAYMENT-RECEIPT{settlementHash, mandateId}
```

The mandate's `ContextBinding.resource` binds the payment to **this exact request** (anti-replay,
PMT-3.1); `mode=closed` makes it one-shot (PMT-INV-14). Settlement is **delegation-native** (redeem the
reader's payment delegation through the DelegationManager + a payment caveat enforcer) — no third-party
facilitator required, consistent with the rest of the stack.

---

## 4. Requirements — agenticprimitives PACKAGES

### 4.1 `payments` — implement the **x402 rail executor** (PAY-RAIL)
The package defines `PaymentRailExecutor` + rail `'x402'` but ships no executor. Implement and
`registerRail` an x402 executor:
- **PAY-RAIL-1** `verifyMandate(mandate)` — structural + signature + `assertContextBindingValid` +
  `assertClosedMandateInvariants` (closed/one-shot for a final charge); confirm `payee == treasury SA`,
  `asset == USDC`, `amount ≤ maxAmount`, `chain == 84532`, not expired, nonce unused.
- **PAY-RAIL-2** `prepareRedemption` — build the on-chain redemption plan: a DelegationManager
  `redeemDelegations` call carrying the reader's payment delegation + the transfer execution
  (USDC `transfer(treasury, amount)` from the reader SA), gated by the payment enforcer (§5.1).
- **PAY-RAIL-3** `executeRedemption` — submit it (as a UserOp / via the service's relayer or a
  paymaster), return `{ receiptHash, settlementHash }` (the settlement tx hash).
- **PAY-RAIL-4** idempotency — a redeemed `mandateId`/`nonce` cannot settle twice (on-chain nonce +
  an off-chain replay cache).

### 4.2 `payments` — **x402 HTTP wire helpers** (PAY-WIRE)
First-class helpers so any service Worker can speak x402 without hand-rolling it:
- **PAY-WIRE-1** `build402(requirements): { status:402, headers, body }` — emit the `Accept-Payment` /
  `PaymentRequirements` body (payTo, asset, maxAmount, network, resource, nonce, expiresAt, mandate
  template).
- **PAY-WIRE-2** `parsePaymentHeader(req): PaymentMandate | null` — decode the `X-PAYMENT` header.
- **PAY-WIRE-3** `buildReceiptHeader(receipt)` — `X-PAYMENT-RECEIPT`.
- **PAY-WIRE-4** wire schema **interop-compatible with the Coinbase x402 spec** where feasible (asset =
  EIP-3009 USDC, `transferWithAuthorization`), with the delegation-native mandate as the
  agentic-primitives extension, so external x402 clients can still pay.

### 4.3 `a2a` — **payment-gated skills** (PAY-A2A)
The a2a package (spec 269) has no payment concept. Add a 402 path to the skill/task lifecycle:
- **PAY-A2A-1** a skill may declare `payment: { rail:'x402', price: AmountPolicy, payee }` in its
  descriptor / `SkillContext`.
- **PAY-A2A-2** when invoked without a valid `X-PAYMENT`, the handler returns a **402** (via PAY-WIRE-1)
  instead of the result — both on the **sync** `/api/a2a` RPC path and the **async task** path (a task
  parks in a `payment-required` state until paid).
- **PAY-A2A-3** on a valid payment, the framework calls the rail executor, attaches the receipt to the
  result/artifact, and only then runs the handler.
- **PAY-A2A-4** the agent-card advertises priced skills (`x402` extension) so clients discover the price
  before calling.

### 4.4 `delegation` — **payment-mandate caveats** (PAY-DEL)
The reader authorizes spend up front (at connect), so per-access payments need **no interactive
signature** — mirror `buildA2aGrantCaveats`:
- **PAY-DEL-1** `buildPaymentMandateCaveats({ payee, asset, maxAmountPerCharge, maxAggregate,
  maxRedemptionsPerWindow, windowSeconds, validUntil })` → the caveat set for a payment delegation
  (delegator = reader, delegate = lbsb scripture agent).
- **PAY-DEL-2** the reader's home mints this delegation during connect (a new
  `delegation_template: 'x402-pay'`), scoped to the lbsb treasury + USDC + a spend cap — so the user
  approves a **budget**, not each micro-charge.
- **PAY-DEL-3** revocation: the reader (or their home) can revoke the payment delegation; the rail
  executor must check `isRevoked` before settling.

### 4.5 `agent-account` — treasury + payer execution + receipts (PAY-ACCT)
- **PAY-ACCT-1** the **treasury** is a plain `AgentAccount` (payee) — no change needed to receive USDC;
  document the pattern + a helper to read its balance/receipts.
- **PAY-ACCT-2** the **payer** transfer is `buildExecuteCallData(USDC.transfer(treasury, amount))`
  executed under the payment delegation — confirm the AgentAccount + DelegationManager path supports a
  delegate-initiated `execute` constrained by the payment enforcer.
- **PAY-ACCT-3** optional: a lightweight on-chain **PaymentReceipt** event/registry so settlements are
  independently auditable (mandateId, payer, payee, amount, resourceHash).

## 5. Requirements — CONTRACTS

### 5.1 **Payment caveat enforcer** (PAY-CON-1) — *new enforcer*
A DeleGator caveat enforcer (sibling of `allowedTargets`/`allowedMethods`/`timestamp`) that constrains
a redeemed payment delegation to **exactly a capped transfer to the treasury**:
- target == USDC token, selector == `transfer`/`transferFrom`, `to == treasury SA`,
  `amount ≤ maxAmountPerCharge`;
- enforce `maxAggregate` and `maxRedemptionsPerWindow/windowSeconds` (stateful, like the timestamp
  enforcer) so a budget can't be drained beyond the mandate;
- bind to the mandate's `nonce`/`contextBinding` hash to prevent replay.

### 5.2 **Settlement path** (PAY-CON-2)
Prefer **delegation-native settlement**: DelegationManager `redeemDelegations(paymentDelegation,
execution=USDC.transfer(treasury, amount))` gated by PAY-CON-1. No external facilitator. (Alternative:
support EIP-3009 `transferWithAuthorization` for Coinbase-x402 interop — D2 in §7.)

### 5.3 **Fee asset** (PAY-CON-3)
A test **USDC** (EIP-3009-capable) on Base Sepolia; reader + treasury AgentAccounts hold it. Provide a
faucet/mint path for demos.

### 5.4 **Receipts** (PAY-CON-4, optional)
Emit a `PaymentSettled(mandateId, payer, payee, asset, amount, resourceHash)` event (or a small
registry) so the service records proof and the reader can verify the charge.

## 6. Consumer side (this repo) — once the platform ships

- **lbsb scripture service agent** = a new (or namespaced) A2A whose `get-gated-passage` / `/vault/*`
  lbsb skills are **priced** (PAY-A2A-1). The existing entitlement gate (§ verify_access) becomes one
  of two gates; x402 is the other (D1).
- **Explorer**: when an lbsb query returns **402**, the reader's session uses its **payment delegation**
  to build + attach the mandate and retry (no per-call popup); show "✓ paid 0.0x USDC → lbsb treasury"
  with the receipt. If no payment delegation, prompt to **approve a spend budget** (mint the `x402-pay`
  delegation, PAY-DEL-2) — analogous to today's license bar.
- **demo-corpus**: the `lbsb.impact` owner view gains a **treasury** tab — balance, recent settlements,
  withdraw — reading the treasury AgentAccount + receipts (PAY-ACCT-1/3).
- Reuses the existing connect/delegation, agent-naming custody checks, and the A2A service binding.

## 7. Open decisions (need your call before building)

- **D1 — pay-per-use vs entitlement.** Does x402 (a) replace entitlements for lbsb (pay each read),
  (b) coexist (either gate satisfies), or (c) **prepay** — one x402 charge mints a time-boxed
  entitlement (cheapest UX, fewer on-chain settlements)? *Recommend (c) for UX, (b) configurable.*
- **D2 — settlement rail.** Delegation-native (PAY-CON-2) only, or also EIP-3009 for external
  x402-client interop? *Recommend delegation-native first.*
- **D3 — price model.** Flat per-call, per-passage, or per-token of returned text (`AmountPolicy`
  exact vs formula)? *Recommend flat per-call to start.*
- **D4 — who submits the settlement tx + gas.** The scripture service relayer (sponsored), the
  reader's UserOp, or a paymaster? *Recommend service-sponsored via paymaster.*
- **D5 — budget UX.** Spend budget per session vs per N-calls vs per-time-window
  (`MandateConstraints.frequency`). *Recommend a per-session USDC budget with a frequency cap.*
