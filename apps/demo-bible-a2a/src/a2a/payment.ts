// x402 pay-per-use SETTLEMENT lane for the lbsb scripture service (spec 272 consumer, Phase 3).
//
// The lbsb /vault gate resolves ONE access lane: grant → prepaid → settlement. grant + prepaid are
// decided by the MCP `verify_access` (live). This is the SETTLEMENT lane: a reader with neither presents
// their x402-pay BUDGET delegation + a fresh nonce; the service builds the redemption and submits it
// GASLESSLY via the demo-a2a relayer + smartAgentPaymaster — the DelegationManager runs the
// PaymentEnforcer and moves USDC reader → treasury. One settlement mints a short prepaid PASS (prepay).
//
// PAY_RELAY_KEY is a SIGNING key (the executor SA's custodian) — it never holds USDC and never pays gas
// (the paymaster does). INERT until PAY_ENABLED="1" + the relay/executor/key are set. Modeled on
// agenticprimitives/apps/demo-web-payment/src/lib/{x402-pay,agent-pay}.ts.
import { encodeFunctionData, keccak256, toBytes, toEventSelector, createPublicClient, http, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import { x402, computeMandateId, type PaymentMandate, type Hex32 } from '@agenticprimitives/payments';
import { DelegationClient, buildPaymentMandateCaveats } from '@agenticprimitives/delegation';

type Relay = { fetch: (url: string, init?: RequestInit) => Promise<Response> };

export type PayEnv = {
  PAY_ENABLED?: string;            // master switch — addresses can be set WITHOUT enabling 402s
  PAY_CHAIN_ID?: string;
  PAY_TREASURY_SA?: string;        // lbsb-treasury.impact Smart Account (payee)
  PAY_ENFORCER?: string;           // PaymentEnforcer contract
  PAY_DELEGATION_MANAGER?: string;
  PAY_ASSET?: string;              // fee token (USDC)
  PAY_PRICE?: string;              // per-access price, atomic units
  PAY_PASS_USES?: string;          // reads a single settlement buys (prepay), default 1
  PAY_PASS_TTL_SECONDS?: string;   // pass lifetime, default 3600
  // Gasless submit (paymaster-sponsored UserOp via the demo-a2a relayer):
  PAY_EXECUTOR_SA?: string;        // the SA that executes redeemDelegation (e.g. lbsb.impact)
  PAY_RELAY_KEY?: string;          // the executor SA's custodian key — SIGNS the userOpHash (no gas, no USDC)
  PAY_RELAY?: Relay;               // service binding to the demo-a2a relayer (build/submit-call-userop)
  PAY_RELAY_URL?: string;          // off-binding fallback URL
  PAY_RELAY_ORIGIN?: string;       // allow-listed origin for the relayer CSRF
  PAY_CHARGE_ENABLED?: string;     // master switch for the app-provisioned-treasury pay-per-use lane
};

/** True only when PAY_ENABLED=1 AND the settle substrate is wired (addresses + executor + signer + relay). */
export function payConfigured(env: PayEnv): boolean {
  return env.PAY_ENABLED === '1'
    && !!(env.PAY_TREASURY_SA && env.PAY_ENFORCER && env.PAY_ASSET && env.PAY_PRICE)
    && !!(env.PAY_EXECUTOR_SA && env.PAY_RELAY_KEY && (env.PAY_RELAY || env.PAY_RELAY_URL));
}

const USDC_DECIMALS = 6;
const EXECUTE_ABI = [{ type: 'function', name: 'execute', stateMutability: 'nonpayable', inputs: [{ name: 'target', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'data', type: 'bytes' }], outputs: [] }] as const;
/** AgentAccount.execute(target, value, data) — the executor SA's outer call. */
function encodeExecute(target: Address, value: bigint, data: Hex): Hex {
  return encodeFunctionData({ abi: EXECUTE_ABI, functionName: 'execute', args: [target, value, data] });
}
/** The canonical resource a settlement buys: an edition access PASS (not a single URL). */
function passResourceHash(edition: string): Hex32 { return keccak256(toBytes(`x402:${edition}:pass`)) as Hex32; }
/** Reader SA from a CAIP-10 subject (`eip155:84532:0x..`). */
function subjectSa(subject: string): Address | null {
  const last = subject.includes(':') ? subject.split(':').pop()! : subject;
  return /^0x[0-9a-fA-F]{40}$/.test(last) ? (last as Address) : null;
}

/** Build the one-shot closed mandate for a single charge (redemption-load-bearing fields). Mirrors the
 *  platform reference's buildCharge. */
function buildLbsbCharge(env: PayEnv, readerSa: Address, edition: string, nonce: bigint): { mandate: PaymentMandate; resourceHash: Hex32 } {
  const chain = Number(env.PAY_CHAIN_ID ?? '84532');
  const now = Math.floor(Date.now() / 1000);
  const asset = { id: env.PAY_ASSET!, symbol: 'USDC', decimals: USDC_DECIMALS };
  const mandate: PaymentMandate = {
    mandateId: computeMandateId({ payer: readerSa, nonce, rail: 'x402', chain }),
    payer: readerSa, payee: env.PAY_TREASURY_SA as Address, granter: readerSa, rail: 'x402',
    amountPolicy: { kind: 'exact', amount: BigInt(env.PAY_PRICE ?? '0'), asset, chain },
    nonce, maxRedemptions: 1, validFrom: now, expiresAt: now + 3600,
    contextBinding: { resource: { method: 'GET', url: `x402:${edition}:pass`, requestBodyHash: ('0x' + '00'.repeat(32)) as Hex32 }, chain, asset, nonce, validFrom: now, expiresAt: now + 3600 },
    mode: 'closed', reasonHash: keccak256(toBytes(`access:${edition}`)) as Hex32, signature: '0x',
  } as PaymentMandate;
  return { mandate, resourceHash: passResourceHash(edition) };
}

export type LbsbSettlement = { settlementHash: string; lane: 'settlement'; mandateId: string; amount: string; passUses: number; passTtl: number };

/** Build the redemption a reader's PERSON SA must execute to pay (the browser can't — no payments pkg).
 *  Given the vault budget delegation (delegator = TREASURY SA), returns the `AgentAccount.execute(DM,
 *  redeemDelegation(...))` callData for `personSa` to submit (via the home gasless or a wallet), moving
 *  USDC TREASURY SA → lbsb treasury. The reader then presents the resulting settlementHash to verify. */
export function buildLbsbRedemption(env: PayEnv, args: { delegation: unknown; edition: string; nonce?: bigint }): { sender: null; to: Address; value: string; executeCallData: Hex; mandateId: string; nonce: string; resourceHash: Hex32 } | null {
  const deleg = args.delegation as { delegator?: string };
  if (!deleg || typeof deleg.delegator !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(deleg.delegator)) return null;
  if (!env.PAY_DELEGATION_MANAGER || !env.PAY_ENFORCER || !env.PAY_ASSET || !env.PAY_TREASURY_SA || !env.PAY_PRICE) return null;
  const nonce = args.nonce ?? BigInt(Date.now());
  const { mandate, resourceHash } = buildLbsbCharge(env, deleg.delegator as Address, args.edition, nonce);
  const plan = x402.buildRedemptionCalldata({
    mandate, delegation: args.delegation as never,
    delegationManager: env.PAY_DELEGATION_MANAGER as Address, paymentEnforcer: env.PAY_ENFORCER as Address,
    asset: env.PAY_ASSET as Address, resourceHash,
  });
  return { sender: null, to: env.PAY_DELEGATION_MANAGER as Address, value: '0', executeCallData: encodeExecute(plan.to, plan.value, plan.data), mandateId: mandate.mandateId, nonce: nonce.toString(), resourceHash };
}

/** The 402 PaymentRequired body for an unpaid lbsb access (x402 erc7710-delegation wire shape). */
export function buildLbsbPaymentRequired(env: PayEnv, edition: string, resource: { method: string; url: string }): unknown {
  const chainId = Number(env.PAY_CHAIN_ID ?? '84532');
  return {
    x402Version: 2, error: 'payment required for ' + edition,
    accepts: [{
      scheme: 'erc7710-delegation', network: 'eip155:' + chainId,
      payTo: env.PAY_TREASURY_SA, payToName: 'lbsb-treasury.impact', asset: env.PAY_ASSET, maxAmountRequired: env.PAY_PRICE,
      enforcer: env.PAY_ENFORCER, delegationManager: env.PAY_DELEGATION_MANAGER,
      resource: { method: resource.method, url: resource.url },
      description: 'Per-access fee for ' + edition + ' → lbsb treasury (buys a ' + (env.PAY_PASS_USES ?? '1') + '-read pass)',
      extra: { passUses: Number(env.PAY_PASS_USES ?? '1'), passTtlSeconds: Number(env.PAY_PASS_TTL_SECONDS ?? '3600'), resourceHash: passResourceHash(edition) },
      maxTimeoutSeconds: 300, mimeType: 'application/json',
    }],
  };
}

async function relayJson(env: PayEnv, path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const r = env.PAY_RELAY ? env.PAY_RELAY.fetch(`https://relay${path}`, init) : fetch(`${(env.PAY_RELAY_URL ?? '').replace(/\/$/, '')}${path}`, init);
  return (await (await r).json()) as Record<string, unknown>;
}

/** Settle a presented x402 payment. The reader sends `PAYMENT-SIGNATURE` = base64({ delegation, nonce })
 *  — their x402-pay budget delegation + a fresh per-charge nonce. We build the redemption and submit
 *  `AgentAccount.execute(DM, 0, redeemDelegation(...))` as a paymaster-sponsored UserOp (gasless) via the
 *  demo-a2a relayer; the PaymentEnforcer moves USDC reader → treasury. Returns the settlement (the gate
 *  then records it + mints a pass). null ⇒ no/invalid payment presented (→ 402) or not configured. */
export async function settleLbsbPayment(
  env: PayEnv,
  args: { edition: string; subject: string; headers: Headers; resource: { method: string; url: string } },
): Promise<LbsbSettlement | null> {
  if (!payConfigured(env)) return null;
  const raw = args.headers.get('PAYMENT-SIGNATURE') || args.headers.get('x-payment') || '';
  if (!raw) return null; // no payment presented → 402
  let payload: { delegation?: unknown; nonce?: string | number };
  try { payload = JSON.parse(typeof atob === 'function' ? atob(raw) : Buffer.from(raw, 'base64').toString()); } catch { return null; }
  const deleg = payload.delegation as { delegator?: string };
  const personSa = subjectSa(args.subject); // the person SA (redeemer / delegate)
  // PAYER = the budget delegation's DELEGATOR = the user's nameless TREASURY SA — the USDC leaves THERE.
  const payerSa = (deleg && typeof deleg.delegator === 'string' && /^0x[0-9a-fA-F]{40}$/.test(deleg.delegator)) ? (deleg.delegator as Address) : personSa;
  if (!deleg || !payerSa) return null;

  const nonce = BigInt(payload.nonce ?? Date.now()); // fresh per-charge nonce (PaymentEnforcer rejects reuse)
  const { mandate, resourceHash } = buildLbsbCharge(env, payerSa, args.edition, nonce);
  const plan = x402.buildRedemptionCalldata({
    mandate, delegation: payload.delegation as never,
    delegationManager: env.PAY_DELEGATION_MANAGER as Address, paymentEnforcer: env.PAY_ENFORCER as Address,
    asset: env.PAY_ASSET as Address, resourceHash,
  });

  // Gasless: build the executor SA's sponsored UserOp via the demo-a2a relayer, sign the hash, submit.
  const origin = env.PAY_RELAY_ORIGIN ?? '';
  const csrf = await relayJson(env, '/auth/csrf', { headers: { origin } });
  const tok = String(csrf.token ?? '');
  const callData = encodeExecute(plan.to, plan.value, plan.data);
  const build = await relayJson(env, '/account/build-call-userop', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': tok, origin }, body: JSON.stringify({ sender: env.PAY_EXECUTOR_SA, callData }) });
  const userOp = build.userOp as Record<string, unknown> | undefined;
  const userOpHash = build.userOpHash as Hex | undefined;
  if (!userOp || !userOpHash) return null; // relayer couldn't build (insufficient budget / bad delegation) → 402
  const signature = await privateKeyToAccount(env.PAY_RELAY_KEY as Hex).signMessage({ message: { raw: userOpHash } });
  const sub = await relayJson(env, '/account/submit-call-userop', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': tok, origin }, body: JSON.stringify({ userOp: { ...userOp, signature } }) });
  const settlementHash = String(sub.transactionHash ?? '');
  if (!settlementHash || (sub.status && sub.status !== 'success' && sub.status !== '0x1')) return null;

  return {
    settlementHash, lane: 'settlement', mandateId: mandate.mandateId, amount: env.PAY_PRICE ?? '0',
    passUses: Number(env.PAY_PASS_USES ?? '1'), passTtl: Number(env.PAY_PASS_TTL_SECONDS ?? '3600'),
  };
}

export type VerifyEnv = PayEnv & { A2A_RPC_URL?: string };
/** Verify mode (reader settles, service CONFIRMS) needs only an RPC + the payee + asset + price — NO
 *  service key, NO relayer. The clean path for the per-user treasury triad: the reader's PERSON SA
 *  already redeemed its vault budget delegation (`treasury → person`), so the USDC has moved from the
 *  user's nameless TREASURY SA → the lbsb treasury. */
export function verifyConfigured(env: VerifyEnv): boolean {
  return env.PAY_ENABLED === '1' && !!(env.PAY_TREASURY_SA && env.PAY_ASSET && env.PAY_PRICE && env.A2A_RPC_URL);
}
const TRANSFER_TOPIC = toEventSelector('Transfer(address,address,uint256)');
/** Confirm a presented settlement on-chain: a successful tx (the reader's `PAYMENT-RESPONSE`) that
 *  contains a USDC `Transfer(to = lbsb treasury, value ≥ price)`. Returns the payer = the `from`
 *  address = the user's nameless TREASURY SA (where the funds left). null ⇒ no/invalid receipt. */
export async function verifyLbsbPayment(env: VerifyEnv, args: { edition: string; headers: Headers }): Promise<{ settlementHash: string; payer: string; amount: string; lane: 'settlement'; passUses: number; passTtl: number } | null> {
  if (!verifyConfigured(env)) return null;
  const raw = args.headers.get('PAYMENT-RESPONSE') || args.headers.get('x-payment-receipt') || '';
  let receipt: { settlementHash?: string };
  try { receipt = JSON.parse(typeof atob === 'function' ? atob(raw) : Buffer.from(raw, 'base64').toString()); } catch { return null; }
  const hash = receipt.settlementHash;
  if (!hash || !/^0x[0-9a-fA-F]{64}$/.test(hash)) return null;
  try {
    const client = createPublicClient({ chain: baseSepolia, transport: http(env.A2A_RPC_URL!) });
    const rcpt = await Promise.race([client.getTransactionReceipt({ hash: hash as Hex }), new Promise<null>((_, r) => setTimeout(() => r(new Error('timeout')), 8000))]);
    if (!rcpt || rcpt.status !== 'success') return null;
    const treasury = String(env.PAY_TREASURY_SA).toLowerCase(), usdc = String(env.PAY_ASSET).toLowerCase(), price = BigInt(env.PAY_PRICE ?? '0');
    for (const log of rcpt.logs) {
      if (log.address.toLowerCase() !== usdc || log.topics[0] !== TRANSFER_TOPIC || !log.topics[1] || !log.topics[2]) continue;
      if (('0x' + log.topics[2].slice(26)).toLowerCase() !== treasury) continue; // to == lbsb treasury
      const val = BigInt(log.data);
      if (val >= price) return { settlementHash: hash, payer: '0x' + log.topics[1].slice(26), amount: val.toString(), lane: 'settlement', passUses: Number(env.PAY_PASS_USES ?? '1'), passTtl: Number(env.PAY_PASS_TTL_SECONDS ?? '3600') };
    }
    return null; // no qualifying USDC → treasury transfer in this tx
  } catch { return null; }
}

export type ProvisionEnv = VerifyEnv & { FAUCET_PK?: string; A2A_ENF_TIMESTAMP?: string; A2A_ENF_TARGETS?: string; A2A_ENF_METHODS?: string; PAY_RELAY?: { fetch: (url: string, init?: RequestInit) => Promise<Response> }; PAY_RELAY_URL?: string; PAY_RELAY_ORIGIN?: string };
export function provisionConfigured(env: ProvisionEnv): boolean {
  return !!(env.FAUCET_PK && env.PAY_ENFORCER && env.PAY_TREASURY_SA && env.PAY_ASSET && env.PAY_DELEGATION_MANAGER && (env.PAY_RELAY || env.PAY_RELAY_URL) && env.A2A_ENF_TIMESTAMP && env.A2A_ENF_TARGETS && env.A2A_ENF_METHODS);
}
/** App-side TREASURY provisioning: 1) gasless-deploy a fresh AgentAccount (custodian = the demo FAUCET,
 *  salt = the person SA → a distinct treasury per user) via the demo-a2a relayer; 2) the FAUCET signs a
 *  `treasury → person` x402-pay budget delegation (PaymentEnforcer-caveated, payee = lbsb treasury,
 *  capped). The caller funds the treasury + stores the budget in the user's vault. */
export async function provisionTreasury(env: ProvisionEnv, args: { personSa: string }): Promise<{ treasury: string; budget: unknown } | { error: string }> {
  if (!provisionConfigured(env)) return { error: 'provisioning not configured' };
  const account = privateKeyToAccount(env.FAUCET_PK as Hex);
  const chainId = Number(env.PAY_CHAIN_ID ?? '84532');
  const origin = env.PAY_RELAY_ORIGIN ?? '';
  const csrf = await relayJson(env, '/auth/csrf', { headers: { origin } });
  const tok = String(csrf.token ?? '');
  const salt = BigInt(keccak256(toBytes('treasury:' + args.personSa))).toString();
  const zero = ('0x' + '00'.repeat(32)) as Hex;
  // 1) gasless deploy the treasury SA (mode-0 EOA-only, custodian = FAUCET)
  const dep = await relayJson(env, '/session/direct-deploy', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': tok, origin }, body: JSON.stringify({ mode: 0, custodians: [account.address], trustees: [], initialPasskeyCredentialIdDigest: zero, initialPasskeyX: '0', initialPasskeyY: '0', initialPasskeyRpIdHash: zero, timelockOverrides: [], salt }) });
  const treasury = dep.deployedAddress as string | undefined;
  if (!treasury || !/^0x[0-9a-fA-F]{40}$/.test(treasury)) return { error: 'deploy failed: ' + String(dep.error ?? dep.detail ?? 'no address') };
  // 2) FAUCET signs the treasury → person x402-pay budget delegation
  const signer = { address: account.address, signTypedData: (a: Parameters<typeof account.signTypedData>[0]) => account.signTypedData(a) };
  const client = new DelegationClient({ signer, smartAccount: treasury as Address, chainId, delegationManager: env.PAY_DELEGATION_MANAGER as Address } as never);
  const caveats = buildPaymentMandateCaveats({
    enforcers: { payment: env.PAY_ENFORCER as Address, timestamp: env.A2A_ENF_TIMESTAMP as Address, allowedTargets: env.A2A_ENF_TARGETS as Address, allowedMethods: env.A2A_ENF_METHODS as Address },
    payee: env.PAY_TREASURY_SA as Address, asset: env.PAY_ASSET as Address,
    maxAmountPerCharge: BigInt(env.PAY_PRICE ?? '0'), maxAggregate: BigInt(env.PAY_PRICE ?? '0') * 1000n,
    maxRedemptionsPerWindow: 100, windowSeconds: 3600, validUntil: Math.floor(Date.now() / 1000) + 86_400,
  } as never);
  const budget = await client.issueDelegation({ delegate: args.personSa as Address, caveats } as never);
  return { treasury, budget };
}

// ── Pay-per-use charge (app-provisioned-treasury settlement) ───────────────────────────────────────
// The clean, working settlement for the demo: the user's treasury SA is FAUCET-custodied (see
// provisionTreasury), so the service can move the per-use fee USDC straight from that treasury → the lbsb
// treasury as a gasless paymaster-sponsored UserOp (the FAUCET signs the userOpHash). This is what fires
// when a connected reader USES the lbsb scripture service. It does NOT need the user's home/wallet key —
// unlike the ERC-7710 redemption lane (settleLbsbPayment), which needs the person SA's custodian to sign.
export type ChargeEnv = PayEnv & { FAUCET_PK?: string };
export function chargeConfigured(env: ChargeEnv): boolean {
  return env.PAY_CHARGE_ENABLED === '1' && !!(env.FAUCET_PK && env.PAY_ASSET && env.PAY_TREASURY_SA && env.PAY_PRICE && (env.PAY_RELAY || env.PAY_RELAY_URL));
}
const ERC20_TRANSFER = [{ type: 'function', name: 'transfer', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] }] as const;

/** Resolve (idempotently CREATE2-deploy) the user's FAUCET-custodied treasury SA. salt = the person SA →
 *  one distinct, deterministic treasury per user; returns the address (no on-chain tx if already deployed). */
export async function resolveTreasurySa(env: ChargeEnv, personSa: string): Promise<string | null> {
  if (!env.FAUCET_PK || !(env.PAY_RELAY || env.PAY_RELAY_URL)) return null;
  const account = privateKeyToAccount(env.FAUCET_PK as Hex);
  const origin = env.PAY_RELAY_ORIGIN ?? '';
  const csrf = await relayJson(env, '/auth/csrf', { headers: { origin } });
  const tok = String(csrf.token ?? '');
  const salt = BigInt(keccak256(toBytes('treasury:' + personSa))).toString();
  const zero = ('0x' + '00'.repeat(32)) as Hex;
  const dep = await relayJson(env, '/session/direct-deploy', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': tok, origin }, body: JSON.stringify({ mode: 0, custodians: [account.address], trustees: [], initialPasskeyCredentialIdDigest: zero, initialPasskeyX: '0', initialPasskeyY: '0', initialPasskeyRpIdHash: zero, timelockOverrides: [], salt }) });
  const t = dep.deployedAddress as string | undefined;
  return (t && /^0x[0-9a-fA-F]{40}$/.test(t)) ? t : null;
}

export type LbsbCharge = { settlementHash: string; treasury: string; payee: string; asset: string; amount: string };
/** Move PAY_PRICE USDC from the reader's FAUCET-custodied treasury SA → the lbsb treasury, gaslessly. */
export async function chargeLbsbTreasury(env: ChargeEnv, args: { personSa: string }): Promise<LbsbCharge | { error: string }> {
  if (!chargeConfigured(env)) return { error: 'charge not configured' };
  const treasury = await resolveTreasurySa(env, args.personSa);
  if (!treasury) return { error: 'could not resolve treasury SA' };
  const price = BigInt(env.PAY_PRICE ?? '0');
  const inner = encodeFunctionData({ abi: ERC20_TRANSFER, functionName: 'transfer', args: [env.PAY_TREASURY_SA as Address, price] });
  const callData = encodeExecute(env.PAY_ASSET as Address, 0n, inner); // treasury.execute(USDC, 0, transfer(lbsbTreasury, price))
  const origin = env.PAY_RELAY_ORIGIN ?? '';
  const csrf = await relayJson(env, '/auth/csrf', { headers: { origin } });
  const tok = String(csrf.token ?? '');
  const build = await relayJson(env, '/account/build-call-userop', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': tok, origin }, body: JSON.stringify({ sender: treasury, callData }) });
  const userOp = build.userOp as Record<string, unknown> | undefined;
  const userOpHash = build.userOpHash as Hex | undefined;
  if (!userOp || !userOpHash) return { error: 'relayer could not build the charge (treasury underfunded?)' };
  const signature = await privateKeyToAccount(env.FAUCET_PK as Hex).signMessage({ message: { raw: userOpHash } });
  const sub = await relayJson(env, '/account/submit-call-userop', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': tok, origin }, body: JSON.stringify({ userOp: { ...userOp, signature } }) });
  const settlementHash = String(sub.transactionHash ?? '');
  if (!settlementHash || (sub.status && sub.status !== 'success' && sub.status !== '0x1')) return { error: 'charge tx failed' };
  return { settlementHash, treasury, payee: env.PAY_TREASURY_SA as string, asset: env.PAY_ASSET as string, amount: price.toString() };
}
