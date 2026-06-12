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
