// x402 pay-per-use SETTLEMENT lane for the lbsb scripture service (spec 272 consumer, Phase 3).
//
// The lbsb /vault gate resolves ONE access lane: grant (owner entitlement) → prepaid (a paid pass) →
// settlement (pay-per-access). grant + prepaid are decided by the MCP `verify_access` (already live).
// This module is the SETTLEMENT lane — INERT until the treasury + PaymentEnforcer + USDC + price +
// relayer are configured; then a reader with neither grant nor prepaid is 402'd, pays reader→treasury,
// and is minted a short session pass (prepay model — D1). Wires @agenticprimitives/payments at activation.
import { x402, entitlement } from '@agenticprimitives/payments';

export type PayEnv = {
  PAY_CHAIN_ID?: string;
  PAY_TREASURY_SA?: string;        // lbsb-treasury.impact Smart Account (payee)
  PAY_ENFORCER?: string;           // PaymentEnforcer contract
  PAY_DELEGATION_MANAGER?: string;
  PAY_ASSET?: string;              // fee token (USDC)
  PAY_PRICE?: string;              // per-access price, atomic units
  PAY_PASS_USES?: string;          // reads a single settlement buys (prepay), default 1
  PAY_PASS_TTL_SECONDS?: string;   // pass lifetime, default 3600
  PAY_RELAY_URL?: string;          // service relayer for the sponsored submitRedemption (X402-D4)
  A2A_RPC_URL?: string;
};

// `_x402`/`_entitlement` are referenced so the linked package is bundled now and ready at activation
// (createX402Rail / buildPaymentRequired / mintEntitlementOnPayment are called once PAY_* is configured).
const _x402 = x402, _entitlement = entitlement;
void _x402; void _entitlement;

/** True once the settlement lane is configured. Until then the gate falls back to grant/prepaid only. */
export function payConfigured(env: PayEnv): boolean {
  return !!(env.PAY_TREASURY_SA && env.PAY_ENFORCER && env.PAY_ASSET && env.PAY_PRICE);
}

/** The 402 PaymentRequired body for an unpaid lbsb access (x402 wire shape; erc7710-delegation rail).
 *  At activation this becomes `x402.buildPaymentRequired(x402.buildPaymentQuote({...}))`. */
export function buildLbsbPaymentRequired(env: PayEnv, edition: string, resource: { method: string; url: string }): unknown {
  const chainId = Number(env.PAY_CHAIN_ID ?? '84532');
  return {
    x402Version: 2,
    error: 'payment required for ' + edition,
    accepts: [{
      scheme: 'erc7710-delegation',
      network: 'eip155:' + chainId,
      payTo: env.PAY_TREASURY_SA,
      asset: env.PAY_ASSET,
      maxAmountRequired: env.PAY_PRICE,
      resource: { method: resource.method, url: resource.url },
      description: 'Per-access fee for the ' + edition + ' licensed scripture service → lbsb treasury',
      mimeType: 'application/json',
      maxTimeoutSeconds: 300,
      extra: { passUses: Number(env.PAY_PASS_USES ?? '1'), passTtlSeconds: Number(env.PAY_PASS_TTL_SECONDS ?? '3600') },
    }],
  };
}

/** Settle a presented x402 payment (header `PAYMENT-SIGNATURE`), then mint a session pass.
 *  INERT until payConfigured(env): returns null (the gate then 402s or 403s). At activation:
 *    1. x402.parsePaymentSignature(headers) → mandate; x402.verifyMandate(mandate, persistedQuote)
 *    2. createX402Rail({chainId, delegationManager, paymentEnforcer, asset, nonceStore (DO),
 *       isRevoked, submitRedemption (relayer sponsored UserOp)}).settle → settlementHash
 *    3. mcp record_settlement + mint_prepaid (a PAY_PASS_USES/TTL pass) → access granted
 *    4. return { settlementHash, lane:'settlement' } + the PAYMENT-RESPONSE receipt header. */
export async function settleLbsbPayment(
  _env: PayEnv,
  _args: { edition: string; subject: string; headers: Headers; resource: { method: string; url: string } },
): Promise<{ settlementHash: string; lane: 'settlement' } | null> {
  if (!payConfigured(_env)) return null; // INERT — no treasury/enforcer/asset/price yet
  // Activation wiring lives here (see steps above). Kept unimplemented until the on-chain config + a
  // funded reader/treasury exist, so the gate degrades cleanly to grant/prepaid + 402.
  return null;
}
