"use client";

// x402 first-charge settlement, run IN the connect ceremony — all-custodian (spec 272). The reader's
// person SA redeems its just-minted `person-treasury → payee` payment delegation (OPEN delegate = push,
// the payer redeems), gaslessly via executeCall. The PaymentEnforcer moves `amount` USDC
// person-treasury → payee. Returns the on-chain settlement tx hash; the relying app verifies it +
// mints an N-read pass. No held key — the reader's own credential signs, the paymaster sponsors gas.
import { encodeFunctionData, keccak256, toBytes } from "viem";
import { x402, computeMandateId, type PaymentMandate, type Hex32 } from "@agenticprimitives/payments";
import type { Address, Hex } from "@agenticprimitives/types";
import { CHAIN_ID, CONTRACTS } from "@/lib/chain";
import { executeCall, type SignHash } from "@/lib/connect";

const PAY_EXECUTE_ABI = [
  { type: "function", name: "execute", stateMutability: "nonpayable", inputs: [{ name: "target", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }], outputs: [] },
] as const;
const PAY_USDC_ABI = [
  { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
] as const;

/** Top up the person-treasury with mock USDC so it can cover the charge. Best-effort + always-mint
 *  (no balance read — avoids a browser-RPC round-trip; minting mock USDC on testnet is harmless). The
 *  mint runs through the SAME gasless executeCall as the charge, so social custody needs no extra gesture. */
async function fundTreasury(personSa: Address, treasury: Address, asset: Address, need: bigint, signHash: SignHash): Promise<void> {
  try {
    const topUp = need > 1_000_000n ? need * 4n : 1_000_000n; // generous buffer so it rarely re-mints
    const mintData = encodeFunctionData({ abi: PAY_USDC_ABI, functionName: "mint", args: [treasury, topUp] });
    const fundCall = encodeFunctionData({ abi: PAY_EXECUTE_ABI, functionName: "execute", args: [asset, 0n, mintData] });
    await executeCall(personSa, signHash, fundCall);
  } catch { /* non-fatal — the redemption fails loudly if truly underfunded */ }
}

export async function chargePayment(
  personSa: Address,
  delegation: unknown,
  signHash: SignHash,
  opts: { payee: Address; asset: Address; amount: bigint; edition: string },
): Promise<{ ok: true; settlementHash: Hex } | { ok: false; error: string }> {
  const deleg = delegation as { delegator?: Address };
  if (!deleg?.delegator) return { ok: false, error: "payment delegation missing delegator" };
  const payer = deleg.delegator;
  await fundTreasury(personSa, payer, opts.asset, opts.amount, signHash);

  const nonce = BigInt(Date.now());
  const now = Math.floor(Date.now() / 1000);
  const zero32 = ("0x" + "00".repeat(32)) as Hex32;
  const asset = { id: opts.asset, symbol: "USDC", decimals: 6 };
  const resourceHash = keccak256(toBytes(`x402:${opts.edition}:pass`)) as Hex32;
  const mandate = {
    mandateId: computeMandateId({ payer, nonce, rail: "x402", chain: CHAIN_ID }),
    payer, payee: opts.payee, granter: payer, rail: "x402",
    amountPolicy: { kind: "exact", amount: opts.amount, asset, chain: CHAIN_ID },
    nonce, maxRedemptions: 1, validFrom: now, expiresAt: now + 3600,
    contextBinding: { resource: { method: "GET", url: `x402:${opts.edition}:pass`, requestBodyHash: zero32 }, chain: CHAIN_ID, asset, nonce, validFrom: now, expiresAt: now + 3600 },
    mode: "closed", reasonHash: keccak256(toBytes(`access:${opts.edition}`)) as Hex32, signature: "0x",
  } as unknown as PaymentMandate;

  const plan = x402.buildRedemptionCalldata({
    mandate, delegation: delegation as never,
    delegationManager: CONTRACTS.delegationManager, paymentEnforcer: CONTRACTS.paymentEnforcer,
    asset: opts.asset, resourceHash,
  });
  const callData = encodeFunctionData({ abi: PAY_EXECUTE_ABI, functionName: "execute", args: [plan.to, plan.value, plan.data] });
  const res = await executeCall(personSa, signHash, callData);
  if (!res.ok) return { ok: false, error: res.error };
  if (!res.txHash) return { ok: false, error: "redemption submitted but no settlement tx hash" };
  return { ok: true, settlementHash: res.txHash };
}
