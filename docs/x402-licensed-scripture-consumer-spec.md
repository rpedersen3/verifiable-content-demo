# x402 Licensed Scripture — Consumer Spec (this repo)

How **this repo** consumes the now-built agenticprimitives payment stack (branch
`feat/payment-stack-spec-alignment`, **spec 272**) to charge a per-use **x402** fee for **lbsb**
scripture access: reader agent wallet → **lbsb treasury** agent wallet. Companion to
`docs/x402-licensed-scripture-payments.md` (platform requirements — now satisfied).

---

## 0. Platform baseline we build on (real APIs)

`@agenticprimitives/payments`
- **x402 rail**: `createX402Rail(deps: X402RailDeps)`, `verifyMandate(mandate, quote, {now})`,
  `buildRedemptionCalldata(...)`, `computeNullifier(...)`. Settlement method **`erc7710-delegation`**
  (delegation-native — DelegationManager redeems the reader's payment delegation → `USDC.transfer(
  treasury, amount)` gated by `PaymentEnforcer`).
- **Wire** (`rails/x402/wire`): `buildPaymentRequired(quote, opts)` / `parsePaymentRequired`,
  `buildPaymentSignature(accepted, mandate)` / `parsePaymentSignature`, `buildPaymentResponse` /
  `parsePaymentResponse`, `serializeMandate`/`deserializeMandate`. Headers `PAYMENT-REQUIRED`,
  `PAYMENT-SIGNATURE`, `PAYMENT-RESPONSE` (`X402_VERSION = 2`).
- **Quote/resource**: `buildPaymentQuote`, `computeQuoteId`, `quoteMismatch`,
  `canonicalizePaymentResource`, `hashRequestBody`. **Nonce store**: `createMemoryNonceStore()` /
  `NonceReservationStore` (we back it with a Durable Object).
- **Mandate signing**: `signPaymentMandate(mandate, signer, opts)`, `paymentMandateDigest`,
  `verifyPaymentMandateSignature(..., read1271)` (EIP-712 `AgenticPaymentMandate`; ERC-1271 for SAs).
- **Prepay lane**: `mintEntitlementOnPayment(input)` / `mintCredits`, `checkEntitlement`,
  `consumeEntitlement` (binding `'sa' | 'bearer'`).

`@agenticprimitives/a2a`
- `SkillPayment { rail, price{amount, asset}, payee }` on a priced skill descriptor.
- `paymentGate?: PaymentGate` on the agent; `PaymentGate.check(...) → PaymentGateDecision { satisfied,
  via?: PaymentLane, required?, receiptRef?, entitlementConsumption? }`.
- **`PaymentLane = 'grant' | 'entitlement' | 'settlement'`** — the gate picks **exactly one** (X402-D8).
- `X402PaymentMetadata` (`x402.payment.status|required|payload|receipts`) for the async-task park;
  `buildPaymentRequiredMetadata`, `x402AgentCardExtension()`, `X402_EXTENSION_URI`.

`@agenticprimitives/delegation`
- `buildPaymentMandateCaveats(opts)` → composes `PaymentEnforcer` (spend + windowed-frequency + transfer-
  only + single-use nonce) with `timestamp` + `allowedTargets`(USDC) + `allowedMethods`. Opts:
  `{ enforcers{payment,timestamp,allowedTargets,allowedMethods}, payee, asset, maxAmountPerCharge,
  maxAggregate, ... }`. `PAYMENT_TRANSFER_SELECTOR`, `describePaymentMandate`.

> **D1 is already answered by the stack:** the gate resolves **one** of three lanes — a standing
> **grant** (the corpus-owner-issued entitlement we already have), a prepaid **entitlement** (consume
> one use, no tx), or a fresh **settlement** (pay-per-call). We wire the policy; we don't choose one.

---

## 1. Topology

| Thing | Value |
|---|---|
| **lbsb scripture service agent** | `lbsb.impact` (already ANS-resolved → `0x91b4…`) — the priced A2A |
| **lbsb treasury agent** (payee) | NEW `lbsb-treasury.impact` (custodied by `lbsb.impact`) — `AgentAccount` |
| Fee asset | test **USDC** (Base Sepolia, chain 84532) |
| Contracts | `PaymentEnforcer` + `delegationManager` + `timestamp/allowedTargets/allowedMethods` enforcers (deployed) |
| Price | flat per call (D3) — e.g. `0.001 USDC` |
| Settlement | `erc7710-delegation`, gas **sponsored by the service relayer** (D4) |

`lbsb.impact` custodies the scripture service **and** the treasury (the spec'd "named user has custody
over the lbsb scripture service agent and lbsb treasury service agent"). We register
`lbsb-treasury.impact` in ANS (like `lbsb.impact`) and verify custody the same way (`isBsbCustodian`).

---

## 2. Service side — `demo-bible-a2a` (the lbsb scripture agent)

**S1 — price the lbsb skills.** Add `payment: SkillPayment` to the lbsb skill descriptors
(`get-gated-passage` and the `/vault/*` lbsb reads): `{ rail:'x402', price:{ amount:'1000', asset:USDC },
payee: treasurySA }`. Advertise `x402AgentCardExtension()` on the agent card.

**S2 — wire one `paymentGate`** into `buildBsbAgent` and the `/vault/*` gate. Implement
`PaymentGate.check()` as the **consumer lane resolver** (exactly one lane):
1. **grant** — the reader already holds an owner-issued entitlement for `lbsb` (today's
   `verify_access` over `entitlements_issued`). → `{satisfied, via:'grant'}`, no tx.
2. **entitlement** — the reader presents a prepaid `entitlementRef`; `checkEntitlement` +
   `consumeEntitlement` (one use). → `{satisfied, via:'entitlement', entitlementConsumption}`.
3. **settlement** — neither: if a valid `PAYMENT-SIGNATURE` is present, run `createX402Rail(...).settle`
   → `{satisfied, via:'settlement', receiptRef}`. Else `{satisfied:false, required: buildPaymentRequired(
   quote)}` → the framework returns **402** (sync) or parks the task with `buildPaymentRequiredMetadata`
   (async).

**S3 — `X402RailDeps` wiring** (`createX402Rail`):
- `chainId 84532`, `delegationManager`, `paymentEnforcer`, `asset = USDC`.
- `nonceStore`: a **Durable Object**-backed `NonceReservationStore` (per-agent, like `BsbTaskDO`) so
  replay/idempotency survives across requests (NOT `createMemoryNonceStore`, which is per-isolate).
- `isRevoked`: viem `delegation.isRevoked` (already used by the A2A on-chain checks).
- `submitRedemption`: a **sponsored UserOp from the lbsb service relayer** (treasury/agent-account
  layer) returning the `settlementHash` — gas paid by the service (D4).

**S4 — quote persistence.** On the 402, persist the `PaymentQuote` (DO/D1) keyed by `quoteId`; on retry
`verifyMandate(mandate, persistedQuote, {now})` + `quoteMismatch` to bind the charge to that exact 402.

**S5 — receipt.** On settle, attach `buildPaymentResponse(receipt)` (`PAYMENT-RESPONSE`) and record the
settlement (txHash, mandateId, payer, amount, resourceHash) in an MCP `payments_settled` ledger.

## 3. Reader side — Explorer (`demo-bible-ontology`)

**R1 — payment budget at connect.** Add a **`x402-pay` payment delegation**: when the reader first hits
a priced lbsb call, prompt to approve a **session budget**. Build caveats with
`buildPaymentMandateCaveats({ enforcers, payee: treasurySA, asset: USDC, maxAmountPerCharge, maxAggregate
})` and have the home mint it (new `delegation_template: 'x402-pay'`). Store it in the session beside the
existing site-login delegation. (Mirrors today's "license bar → approve" UX, but it grants a **spend
cap**, not a one-off.)

**R2 — auto-pay on 402.** Generalize `api()` (and the licensed resolve calls): when a response carries
`PAYMENT-REQUIRED`, `parsePaymentRequired` → build a `PaymentMandate` (payer = reader SA, payee =
treasury, `amountPolicy` from the quote, `contextBinding.resource` = this request,
`railConfig{quoteId,resourceHash}`, `delegationRef` = the x402-pay delegation), `signPaymentMandate`
(ERC-1271 via the reader's home / connect signature), attach `buildPaymentSignature(accepted, mandate)`
as `PAYMENT-SIGNATURE`, and **retry** — no per-call popup (the budget already consented).

**R3 — receipt + meter.** On success, `parsePaymentResponse` → show **"✓ paid 0.001 USDC → lbsb
treasury · tx 0x…"** and a small **budget meter** ("spent 0.012 / 0.10 USDC this session"). When the
budget is exhausted or the delegation expired/revoked → re-prompt R1.

**R4 — prepay option.** Offer "**Buy 100 reads**" → one settlement that `mintEntitlementOnPayment`
(maxUses=100) → subsequent calls take the **entitlement** lane (no tx, faster). This is the recommended
default UX (D1=prepay); pay-per-call remains the fallback.

## 4. Owner side — `demo-corpus` treasury tab

**T1 — Treasury page** (new nav tab, lbsb corpus only): read the `lbsb-treasury.impact` AgentAccount
**USDC balance** + the `payments_settled` ledger (recent charges: payer, amount, resource, tx, time) via
a new MCP `list_settlements` (edition-scoped). Owner-gated to the `lbsb.impact` custodian (the existing
`ownerGate`/custody check).

**T2 — Withdraw** (optional): a `buildExecuteCallData(USDC.transfer(owner, amount))` from the treasury
AgentAccount, authorized by the `lbsb.impact` custodian — moves accrued fees out of the treasury.

## 5. MCP additions (`demo-bible-mcp`)

- `record_settlement` / `list_settlements{edition}` — the `payments_settled` ledger (mirrors
  `entitlements_issued`).
- `get_quote{edition, reference, subject}` — issues + persists a `PaymentQuote` for the 402.
- Reuse `verify_access` as the **grant** lane; add `consume_prepaid{subject, edition}` for the
  **entitlement** lane (wrapping `checkEntitlement`/`consumeEntitlement`).

## 6. Settlement & receipts (how the money moves)

`erc7710-delegation`: `buildRedemptionCalldata` → `DelegationManager.redeemDelegation(x402-pay
delegation, USDC.transfer(treasurySA, amount))`, with the `PaymentEnforcer` caveat `args` filled at
redemption with `(mandateId, nonce, resourceHash)` — enforcing **transfer-only to treasury**, **≤
maxAmountPerCharge**, **≤ maxAggregate**, **windowed frequency**, **single-use nonce**. The service
relayer submits it as a **sponsored UserOp**; `settlementHash` is the receipt. No third-party
facilitator.

## 7. Config / addresses to supply

`PaymentEnforcer`, USDC token, `lbsb-treasury.impact` SA, the price (`maxAmountPerCharge`), the session
`maxAggregate`, the service relayer key/paymaster. (Enforcer + DM + timestamp/allowedTargets/
allowedMethods already in `demo-bible-mcp` / `demo-bible-a2a` wrangler from the A2A bus work.)

## 8. Build order

1. **Treasury agent** — register `lbsb-treasury.impact`, fund both SAs with test USDC. *(unblocks all)*
2. **MCP** — `payments_settled` ledger + `get_quote`/`record_settlement`/`list_settlements`/`consume_prepaid`.
3. **Service** — `SkillPayment` on lbsb skills + the `paymentGate` lane resolver + `createX402Rail` deps
   (DO nonce store, sponsored `submitRedemption`). Card extension.
4. **Reader** — `x402-pay` delegation at connect + auto-pay-on-402 + receipt/meter + prepay button.
5. **Owner** — demo-corpus Treasury tab (balance + settlements + withdraw).

## 9. Relationship to the existing lbsb gate

Today lbsb `/vault/*` is gated by **`verify_access`** (the owner-issued entitlement = the **grant**
lane). x402 adds the **entitlement** (prepaid) and **settlement** (pay-per-call) lanes through the same
`PaymentGate`. Policy (recommended): try **grant → prepaid-entitlement → settlement**; a reader with an
owner grant pays nothing, others prepay or pay-per-read. One code path, three lanes, the gate logs which.

## 10. Open consumer decisions

- **C1** — gate on **every** lbsb call (true micropayment, more settlements) vs once-per-session-budget
  then free reads until budget/quote rolls (fewer tx). *Recommend: settle on entitlement mint (prepay),
  then consume; pay-per-call only when no prepaid balance.*
- **C2** — does the **owner grant** (demo-corpus approval) stay free, or also draw from a prepaid pool?
  *Recommend: owner grant = free (comp/admin lane).*
- **C3** — price unit: flat per call vs per passage vs per N verses. *Recommend flat per call to start.*
