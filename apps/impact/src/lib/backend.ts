// ============================================================================
// Live backend read client — talks to the deployed impact-a2a
// Worker through the same-origin /a2a proxy (next.config.mjs rewrite). These are
// the secret-free reads (health, on-chain registry, JSON-RPC, reverse-name).
// Authenticated writes (vault set, custody bootstrap, delegation signing) need
// the bridge secret + a session and bind in a later sub-phase behind this module.
// ============================================================================

import { BACKEND } from "./domain";
import type { Address } from "./types";

export interface Health {
  ok: boolean;
  service: string;
  chainId: number;
  factory?: string;
  runtime?: string;
}

export interface Deployments {
  chainId: number;
  delegationManager: string;
  agentAccountFactory: string;
  timestampEnforcer: string;
  allowedTargetsEnforcer: string;
  allowedMethodsEnforcer: string;
  valueEnforcer: string;
  universalSignatureValidator: string;
  agentNameRegistry: string;
  agentNameUniversalResolver: string;
  [k: string]: string | number;
}

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BACKEND.a2a}${path}`, {
    ...init,
    headers: { accept: "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

export function getHealth(): Promise<Health> {
  return getJson<Health>("/health");
}

export function getDeployments(): Promise<Deployments> {
  return getJson<Deployments>("/deployments");
}

// ── JSON-RPC (proxied to Base Sepolia) ──────────────────────────────────────────
let rpcId = 0;
export async function rpc<T = string>(method: string, params: unknown[] = []): Promise<T> {
  const body = { jsonrpc: "2.0", id: ++rpcId, method, params };
  const res = await fetch(`${BACKEND.a2a}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`/rpc ${method} → HTTP ${res.status}`);
  const json = (await res.json()) as { result?: T; error?: { message: string } };
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result as T;
}

export async function getBlockNumber(): Promise<number> {
  return parseInt(await rpc<string>("eth_blockNumber"), 16);
}

export async function getChainId(): Promise<number> {
  return parseInt(await rpc<string>("eth_chainId"), 16);
}

/** Whether an address has deployed contract code on-chain (a Smart Agent is a contract). */
export async function isContract(address: Address): Promise<boolean> {
  const code = await rpc<string>("eth_getCode", [address, "latest"]);
  return !!code && code !== "0x";
}

/** Native ETH balance, in wei. */
export async function getEthBalance(address: Address): Promise<bigint> {
  return BigInt(await rpc<string>("eth_getBalance", [address, "latest"]));
}

/** ERC-20 balanceOf via eth_call (selector 0x70a08231). */
export async function erc20BalanceOf(token: Address, owner: Address): Promise<bigint> {
  const data = "0x70a08231" + owner.slice(2).toLowerCase().padStart(64, "0");
  const out = await rpc<string>("eth_call", [{ to: token, data }, "latest"]);
  return out && out !== "0x" ? BigInt(out) : 0n;
}

export interface NameInfo {
  exists: boolean;
  name?: string;
  agent?: Address;
  deployed?: boolean;
  hasEoa?: boolean;
  hasPasskey?: boolean;
}

/** Resolve a name against the agent naming service (via the ported /connect/name-info). */
export async function getNameInfo(name: string): Promise<NameInfo> {
  try {
    const r = await fetch(`/connect/name-info?name=${encodeURIComponent(name)}`);
    if (!r.ok) return { exists: false };
    return (await r.json()) as NameInfo;
  } catch {
    return { exists: false };
  }
}

/** Reverse-resolve an agent address → its primary .impact name (or null). */
export async function reverseName(address: Address): Promise<string | null> {
  const r = await getJson<{ address: string; name: string | null }>(
    `/name/reverse?address=${address}`,
  );
  return r.name;
}

/** Format a bigint token amount with `decimals` to a fixed-`places` string. */
export function formatUnits(value: bigint, decimals: number, places = 2): string {
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const frac = value % base;
  const fracStr = frac.toString().padStart(decimals, "0").slice(0, places);
  return `${whole.toString()}.${fracStr}`;
}
