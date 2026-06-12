// x402 pay-per-use SETTLEMENT lane for the lbsb scripture service (spec 272 consumer, Phase 3).
//
// The lbsb /vault gate resolves ONE access lane: grant → prepaid → settlement. grant + prepaid are
// decided by the MCP `verify_access` (live). This is the SETTLEMENT lane: a reader with neither presents
// their x402-pay BUDGET delegation + a per-charge nonce; the service builds the redemption and submits
// it via its relayer — the DelegationManager runs the PaymentEnforcer and moves USDC reader → treasury.
// One settlement mints a short prepaid PASS (prepay model — D1), so the reader then browses freely.
//
// INERT until PAY_ENABLED="1" AND the addresses/relayer are set. Modeled on the platform reference
// agenticprimitives/apps/demo-web-payment/src/lib/x402-pay.ts (buildCharge + buildRedemptionCalldata).
import { keccak256, toBytes, createWalletClient, http, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import { x402, computeMandateId, type PaymentMandate, type Hex32 } from '@agenticprimitives/payments';

export type PayEnv = {
  PAY_ENABLED?: string;            // master switch — addresses can be set WITHOUT enabling 402s
  PAY_CHAIN_ID?: string;
  PAY_TREASURY_SA?: string;        // lbsb-treasury.impact Smart Account (payee)
  PAY_ENFORCER?: string;           // PaymentEnforcer contract
  PAY_DELEGATION_MANAGER?: string;
  PAY_PAYMASTER?: string;          // smartAgentPaymaster (sponsors the settlement UserOp)
  PAY_ENTRY_POINT?: string;
  PAY_RECEIPT_REGISTRY?: string;   // paymentReceiptRegistry
  PAY_ASSET?: string;              // fee token (USDC)
  PAY_PRICE?: string;              // per-access price, atomic units
  PAY_PASS_USES?: string;          // reads a single settlement buys (prepay), default 1
  PAY_PASS_TTL_SECONDS?: string;   // pass lifetime, default 3600
  PAY_RELAY_KEY?: string;          // service relayer private key (a funded EOA) — submits redeemDelegation
  A2A_RPC_URL?: string;
};

/** True only when PAY_ENABLED=1 AND the addresses + relayer are set — so addresses can be wired in
 *  config WITHOUT 402-ing readers until the settle path + reader auto-pay are complete. */
export function payConfigured(env: PayEnv): boolean {
  return env.PAY_ENABLED === '1' && !!(env.PAY_TREASURY_SA && env.PAY_ENFORCER && env.PAY_ASSET && env.PAY_PRICE && env.PAY_RELAY_KEY && env.A2A_RPC_URL);
}

const USDC_DECIMALS = 6;
/** The canonical resource a settlement buys: an edition access PASS (not a single URL). */
function passResourceHash(edition: string): Hex32 {
  return keccak256(toBytes(`x402:${edition}:pass`)) as Hex32;
}
/** Reader SA from a CAIP-10 subject (`eip155:84532:0x..`). */
function subjectSa(subject: string): Address | null {
  const last = subject.includes(':') ? subject.split(':').pop()! : subject;
  return /^0x[0-9a-fA-F]{40}$/.test(last) ? (last as Address) : null;
}

/** Build the one-shot closed mandate for a single charge (only the redemption-load-bearing fields).
 *  Mirrors the platform reference's buildCharge. */
function buildLbsbCharge(env: PayEnv, readerSa: Address, edition: string, nonce: bigint): { mandate: PaymentMandate; resourceHash: Hex32 } {
  const chain = Number(env.PAY_CHAIN_ID ?? '84532');
  const now = Math.floor(Date.now() / 1000);
  const resourceHash = passResourceHash(edition);
  const asset = { id: env.PAY_ASSET!, symbol: 'USDC', decimals: USDC_DECIMALS };
  const price = BigInt(env.PAY_PRICE ?? '0');
  const mandate: PaymentMandate = {
    mandateId: computeMandateId({ payer: readerSa, nonce, rail: 'x402', chain }),
    payer: readerSa,
    payee: env.PAY_TREASURY_SA as Address,
    granter: readerSa,
    rail: 'x402',
    amountPolicy: { kind: 'exact', amount: price, asset, chain },
    nonce,
    maxRedemptions: 1,
    validFrom: now,
    expiresAt: now + 3600,
    contextBinding: {
      resource: { method: 'GET', url: `x402:${edition}:pass`, requestBodyHash: ('0x' + '00'.repeat(32)) as Hex32 },
      chain, asset, nonce, validFrom: now, expiresAt: now + 3600,
    },
    mode: 'closed',
    reasonHash: keccak256(toBytes(`access:${edition}`)) as Hex32,
    signature: '0x',
  } as PaymentMandate;
  return { mandate, resourceHash };
}

export type LbsbSettlement = { settlementHash: string; lane: 'settlement'; mandateId: string; amount: string; passUses: number; passTtl: number };

/** The 402 PaymentRequired body for an unpaid lbsb access (x402 erc7710-delegation wire shape). */
export function buildLbsbPaymentRequired(env: PayEnv, edition: string, resource: { method: string; url: string }): unknown {
  const chainId = Number(env.PAY_CHAIN_ID ?? '84532');
  return {
    x402Version: 2,
    error: 'payment required for ' + edition,
    accepts: [{
      scheme: 'erc7710-delegation', network: 'eip155:' + chainId,
      payTo: env.PAY_TREASURY_SA, asset: env.PAY_ASSET, maxAmountRequired: env.PAY_PRICE,
      resource: { method: resource.method, url: resource.url },
      description: 'Per-access fee for ' + edition + ' → lbsb treasury (buys a ' + (env.PAY_PASS_USES ?? '1') + '-read pass)',
      payToName: 'lbsb-treasury.impact', enforcer: env.PAY_ENFORCER, delegationManager: env.PAY_DELEGATION_MANAGER,
      extra: { passUses: Number(env.PAY_PASS_USES ?? '1'), passTtlSeconds: Number(env.PAY_PASS_TTL_SECONDS ?? '3600'), resourceHash: passResourceHash(edition) },
      maxTimeoutSeconds: 300, mimeType: 'application/json',
    }],
  };
}

/** Settle a presented x402 payment. The reader sends `PAYMENT-SIGNATURE` = base64({ delegation, nonce }) —
 *  their x402-pay budget delegation + a fresh per-charge nonce. We build the redemption and submit
 *  `DelegationManager.redeemDelegation(...)` from the service relayer; the PaymentEnforcer moves USDC
 *  reader → treasury. Returns the settlement (the gate then records it + mints a pass). null ⇒ no/invalid
 *  payment presented (→ the gate 402s) or not configured. */
export async function settleLbsbPayment(
  env: PayEnv,
  args: { edition: string; subject: string; headers: Headers; resource: { method: string; url: string } },
): Promise<LbsbSettlement | null> {
  if (!payConfigured(env)) return null;
  const raw = args.headers.get('PAYMENT-SIGNATURE') || args.headers.get('x-payment') || '';
  if (!raw) return null; // no payment presented → 402
  let payload: { delegation?: unknown; nonce?: string | number };
  try { payload = JSON.parse(typeof atob === 'function' ? atob(raw) : Buffer.from(raw, 'base64').toString()); } catch { return null; }
  const delegation = payload.delegation;
  const readerSa = subjectSa(args.subject);
  if (!delegation || !readerSa) return null;

  const nonce = BigInt(payload.nonce ?? Date.now()); // fresh per-charge nonce (PaymentEnforcer rejects reuse)
  const { mandate, resourceHash } = buildLbsbCharge(env, readerSa, args.edition, nonce);
  const plan = x402.buildRedemptionCalldata({
    mandate,
    delegation: delegation as never,
    delegationManager: env.PAY_DELEGATION_MANAGER as Address,
    paymentEnforcer: env.PAY_ENFORCER as Address,
    asset: env.PAY_ASSET as Address,
    resourceHash,
  });

  // Service relayer submits the redemption tx (the DM runs the enforcer + moves USDC). Gas paid by the relayer.
  const account = privateKeyToAccount(env.PAY_RELAY_KEY as Hex);
  const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(env.A2A_RPC_URL!) });
  const settlementHash = await wallet.sendTransaction({ to: plan.to, value: plan.value, data: plan.data });

  return {
    settlementHash, lane: 'settlement', mandateId: mandate.mandateId, amount: env.PAY_PRICE ?? '0',
    passUses: Number(env.PAY_PASS_USES ?? '1'), passTtl: Number(env.PAY_PASS_TTL_SECONDS ?? '3600'),
  };
}
