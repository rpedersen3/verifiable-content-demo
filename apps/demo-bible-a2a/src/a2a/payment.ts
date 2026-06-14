// x402 pay-per-use for the lbsb scripture service (spec 272 consumer) — KEYLESS.
//
// The lbsb /vault gate resolves ONE access lane: grant → prepaid → settlement. grant + prepaid come from
// the MCP `verify_access`. This module is the SETTLEMENT lane, done with NO held key:
//   • buildLbsbRedemption — builds the `redeemDelegation` calldata the READER's person SA executes
//     (the browser can't — no payments pkg). The reader signs + submits it with their OWN wallet
//     (gasless via the demo-a2a relayer + paymaster); the DelegationManager runs the PaymentEnforcer and
//     moves USDC person-treasury → lbsb treasury. One redemption buys a short prepaid PASS.
//   • verifyLbsbPayment — confirms the reader's presented settlement on-chain (a USDC Transfer to the lbsb
//     treasury ≥ price). RPC-only: no service key, no relayer. This is how the gate trusts the payment.
//
// There is NO server-side settle and NO faucet here: the service never holds a key that can move money.
import { keccak256, toBytes, toEventSelector, createPublicClient, http, type Hex } from 'viem';
import { baseSepolia } from 'viem/chains';
import { type Hex32 } from '@agenticprimitives/payments';

export type PayEnv = {
  PAY_ENABLED?: string;            // master switch for the (keyless) settlement lane
  PAY_CHAIN_ID?: string;
  PAY_TREASURY_SA?: string;        // lbsb-treasury.impact Smart Account (payee)
  PAY_ENFORCER?: string;           // PaymentEnforcer contract
  PAY_DELEGATION_MANAGER?: string;
  PAY_ASSET?: string;              // fee token (USDC)
  PAY_PRICE?: string;              // per-access price, atomic units
  PAY_PASS_USES?: string;          // reads a single settlement buys (prepay), default 1
  PAY_PASS_TTL_SECONDS?: string;   // pass lifetime, default 3600
};

/** The canonical resource a settlement buys: an edition access PASS (not a single URL). */
function passResourceHash(edition: string): Hex32 { return keccak256(toBytes(`x402:${edition}:pass`)) as Hex32; }

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

export type VerifyEnv = PayEnv & { A2A_RPC_URL?: string };
/** The keyless verify gate needs only an RPC + the payee + asset + price — NO service key, NO relayer. */
export function verifyConfigured(env: VerifyEnv): boolean {
  return env.PAY_ENABLED === '1' && !!(env.PAY_TREASURY_SA && env.PAY_ASSET && env.PAY_PRICE && env.A2A_RPC_URL);
}
const TRANSFER_TOPIC = toEventSelector('Transfer(address,address,uint256)');
/** Confirm a presented settlement on-chain: a successful tx (the reader's `PAYMENT-RESPONSE`) containing a
 *  USDC `Transfer(to = lbsb treasury, value ≥ price)`. Returns the payer = the `from` = the person-treasury
 *  SA (where the funds left). null ⇒ no/invalid receipt. */
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
