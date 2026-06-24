// Real connect — passkey (WebAuthn) + SIWE (wallet) sign-in/bootstrap against the
// live demo-a2a relayer + the ported broker routes (/connect/*, /me). Ported from
// agenticprimitives/demo-sso-next/src/connect-client.ts, trimmed to the sign-in
// substrate (no org/delegation/treasury/payment surface). Social (Google/YouVersion)
// is wired separately and needs the custody-bridge env.
import { buildMessage } from "@agenticprimitives/connect-auth/siwe";
import {
  buildSubregistryRegisterCall,
  buildSetPrimaryNameCall,
} from "@agenticprimitives/agent-naming";
import {
  buildExecuteBatchCallData,
  AgentAccountClient,
  type ContractCall,
} from "@agenticprimitives/agent-account";
import type { Address, Hex } from "@agenticprimitives/types";
import {
  connectWallet,
  personalSign,
  rememberHomeEoa,
} from "./wallet";
import {
  registerPasskey,
  signWithPasskey,
  loadPasskey,
  type DemoPasskey,
} from "./passkey";
import { ensureCsrfToken, csrfHeaders } from "../csrf";
import { CONTRACTS, DEFAULT_RPC_URL } from "./chain";

export type SignHash = (hash: Hex) => Promise<Hex>;
export const AUD = "impact";
const CHAIN_ID = 84532;

export interface BasicProfile {
  agent: string;
  name: string | null;
  credential: string;
  access: string;
  deployed: boolean;
}

export type ConnectVia = "passkey" | "wallet" | "google" | "youversion";

/** What a successful connect yields for the session. */
export interface ConnectResult {
  ok: true;
  token: string;
  via: ConnectVia;
  address: Address;
  name: string | null;
  deployed: boolean;
  fresh: boolean;
}
export type ConnectOutcome = ConnectResult | { ok: false; error: string };

/** Parse a response body safely — never throws on empty/non-JSON (e.g. a 500 with an
 *  empty body), so callers surface a real message instead of "Unexpected end of JSON input". */
async function readJson<T = Record<string, unknown>>(r: Response): Promise<T & { error?: string; _raw?: string }> {
  const text = await r.text();
  let parsed: unknown = {};
  if (text) {
    try { parsed = JSON.parse(text); }
    catch { parsed = { _raw: text.slice(0, 200) }; }
  }
  return parsed as T & { error?: string; _raw?: string };
}

/** A human message for a failed broker response (prefers the JSON `error`, then status). */
function httpError(r: Response, body: { error?: string; _raw?: string }): string {
  return body.error || body._raw || `request failed (HTTP ${r.status})`;
}

async function getNonce(): Promise<string> {
  const r = await fetch("/connect/nonce");
  const body = await readJson<{ nonce?: string }>(r);
  if (!r.ok || !body.nonce) throw new Error(httpError(r, body) || "nonce fetch failed");
  return body.nonce;
}

function agentAccountClient(): AgentAccountClient {
  return new AgentAccountClient({
    rpcUrl: DEFAULT_RPC_URL,
    chainId: CHAIN_ID,
    entryPoint: CONTRACTS.entryPoint,
    factory: CONTRACTS.agentAccountFactory,
  });
}

/** sha256(hostname) — must match the rpIdHash the server bakes into the passkey-SA CREATE2 salt. */
async function derivePasskeyRpIdHash(): Promise<Hex> {
  const hostname = typeof window !== "undefined" ? window.location.hostname : "impact-agent.me";
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(hostname));
  const arr = Array.from(new Uint8Array(buf));
  return ("0x" + arr.map((b) => b.toString(16).padStart(2, "0")).join("")) as Hex;
}

async function derivePasskeySa(passkey: DemoPasskey, salt: bigint): Promise<Address> {
  const rpIdHash = await derivePasskeyRpIdHash();
  return agentAccountClient().getAddressForAgentAccount({
    custodians: [],
    passkey: { credentialIdDigest: passkey.credentialIdDigest, x: passkey.pubKeyX, y: passkey.pubKeyY, rpIdHash },
    salt,
  });
}

/** Pick a free name + build executeBatch(register, setPrimary) for the new SA to claim it. */
async function buildClaimCallData(
  base: string,
  sa: Address,
): Promise<{ ok: true; callData: Hex; name: string } | { ok: false; error: string }> {
  const picked = (await (await fetch(`/connect/name?base=${encodeURIComponent(base)}`)).json()) as {
    label?: string; name?: string; node?: Hex; error?: string;
  };
  if (!picked.name || !picked.node || !picked.label) return { ok: false, error: picked.error ?? "no free name" };
  const register = buildSubregistryRegisterCall({ subregistry: CONTRACTS.permissionlessSubregistry, label: picked.label, newOwner: sa });
  const setPrimary = buildSetPrimaryNameCall({ registry: CONTRACTS.agentNameRegistry, node: picked.node });
  const calls: ContractCall[] = [register, setPrimary];
  return { ok: true, callData: buildExecuteBatchCallData(calls), name: picked.name };
}

/** Build → sign → submit a call from a deployed SA (via the live relayer), with a nonce gate. */
async function executeCall(
  sender: Address,
  signHash: SignHash,
  callData: Hex,
  opts: { minNonce?: bigint; attempts?: number } = {},
): Promise<{ ok: true; txHash?: Hex } | { ok: false; error: string }> {
  const { minNonce, attempts = 8 } = opts;
  await ensureCsrfToken();
  let lastErr = "execute failed";
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 2500));
    const buildRes = await fetch("/a2a/account/build-call-userop", {
      method: "POST", credentials: "include",
      headers: { "content-type": "application/json", ...csrfHeaders() },
      body: JSON.stringify({ sender, callData }),
    });
    const b = (await buildRes.json()) as { ok?: boolean; userOpHash?: Hex; userOp?: Record<string, unknown> & { nonce?: string }; error?: string; detail?: string };
    if (!buildRes.ok || !b.ok || !b.userOpHash || !b.userOp) {
      lastErr = [b.error, b.detail].filter(Boolean).join(" — ") || `build-call failed (HTTP ${buildRes.status})`;
      continue;
    }
    if (minNonce !== undefined && BigInt(b.userOp.nonce ?? "0") < minNonce) {
      lastErr = `relayer nonce ${b.userOp.nonce} < ${minNonce} — deploy not yet propagated`;
      continue;
    }
    const signature = await signHash(b.userOpHash);
    const submitRes = await fetch("/a2a/account/submit-call-userop", {
      method: "POST", credentials: "include",
      headers: { "content-type": "application/json", ...csrfHeaders() },
      body: JSON.stringify({ userOp: { ...b.userOp, signature } }),
    });
    const submitted = (await submitRes.json()) as { ok?: boolean; transactionHash?: Hex; error?: string; detail?: string };
    if (submitRes.ok && submitted.ok) return { ok: true, txHash: submitted.transactionHash };
    lastErr = [submitted.error, submitted.detail].filter(Boolean).join(" — ") || `submit-call failed (HTTP ${submitRes.status})`;
  }
  return { ok: false, error: lastErr };
}

// ── Passkey ──────────────────────────────────────────────────────────────────
export const passkeySignHash: SignHash = (hash) => signWithPasskey(hash);

type PasskeyOutcome =
  | { status: "issued"; token: string; passkey: DemoPasskey }
  | { status: "bootstrap"; passkey: DemoPasskey }
  | { status: "rejected"; passkey?: DemoPasskey; reason?: string };

type Step = (s: string) => void;

async function passkeyLogin(registerIfMissing = true, onStep?: Step): Promise<PasskeyOutcome> {
  let passkey = loadPasskey();
  if (!passkey) {
    if (!registerIfMissing) return { status: "rejected", reason: "no passkey on this device" };
    onStep?.("Creating a passkey on this device — confirm with your authenticator…");
    passkey = await registerPasskey("Impact home passkey");
  } else {
    onStep?.("Touch your authenticator to prove it's you…");
  }
  const { challenge } = (await (await fetch("/connect/passkey-challenge")).json()) as { challenge: Hex };
  const signature = await signWithPasskey(challenge);
  onStep?.("Checking your home on-chain…");
  const r = await fetch("/connect/passkey", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      credentialIdDigest: passkey.credentialIdDigest,
      pubKeyX: passkey.pubKeyX.toString(), pubKeyY: passkey.pubKeyY.toString(),
      challenge, signature, aud: AUD,
    }),
  });
  const body = await readJson<{ status?: string; token?: string }>(r);
  if (r.ok && body.status === "issued" && body.token) return { status: "issued", token: body.token, passkey };
  if (r.ok && body.status === "bootstrap") return { status: "bootstrap", passkey };
  return { status: "rejected", passkey, reason: httpError(r, body) };
}

/** Deploy a passkey-direct SA via the relayer; `callData` (name claim) rides in the deploy op. */
async function bootstrapWithPasskey(passkey: DemoPasskey, callData?: Hex, onStep?: Step): Promise<{ ok: true; agent: Address } | { ok: false; error: string }> {
  onStep?.("Preparing your home…");
  await ensureCsrfToken();
  const rpIdHash = await derivePasskeyRpIdHash();
  const buildRes = await fetch("/a2a/session/deploy", {
    method: "POST", credentials: "include",
    headers: { "content-type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({
      initMethod: "passkey",
      credentialIdDigest: passkey.credentialIdDigest,
      pubKeyX: passkey.pubKeyX.toString(), pubKeyY: passkey.pubKeyY.toString(),
      rpIdHash, ...(callData ? { callData } : {}),
    }),
  });
  if (buildRes.status === 409) return { ok: false, error: "Gas sponsorship is not enabled on the backend (paymaster)." };
  const built = (await readJson<{ ok?: boolean; userOpHash?: Hex; userOp?: Record<string, unknown>; error?: string; _raw?: string }>(buildRes));
  if (!buildRes.ok || !built.ok || !built.userOpHash || !built.userOp) return { ok: false, error: httpError(buildRes, built) || `deploy build failed (HTTP ${buildRes.status})` };
  onStep?.("Touch your authenticator to authorize the deploy…");
  const signature = await signWithPasskey(built.userOpHash);
  onStep?.("Securing your home on the network…");
  const submitRes = await fetch("/a2a/session/deploy/submit", {
    method: "POST", credentials: "include",
    headers: { "content-type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ userOp: { ...built.userOp, signature } }),
  });
  const submitted = (await submitRes.json()) as { ok?: boolean; deployedAddress?: Address; error?: string; detail?: string };
  if (!submitRes.ok || !submitted.ok || !submitted.deployedAddress) {
    return { ok: false, error: [submitted.error, submitted.detail].filter(Boolean).join(" — ") || `deploy submit failed (HTTP ${submitRes.status})` };
  }
  return { ok: true, agent: submitted.deployedAddress };
}

async function deployAndClaimPasskey(passkey: DemoPasskey, base: string, onStep?: Step): Promise<{ ok: true; agent: Address; name: string } | { ok: false; error: string }> {
  onStep?.("Finding a free name…");
  const sa = await derivePasskeySa(passkey, 0n);
  const claim = await buildClaimCallData(base, sa);
  if (!claim.ok) return { ok: false, error: claim.error };
  const dep = await bootstrapWithPasskey(passkey, claim.callData, onStep);
  if (!dep.ok) return { ok: false, error: dep.error };
  return { ok: true, agent: dep.agent, name: claim.name };
}

// ── SIWE / wallet ──────────────────────────────────────────────────────────────
type SiweOutcome =
  | { status: "issued"; token: string; address: Address; agent: Address }
  | { status: "bootstrap"; address: Address }
  | { status: "rejected"; address?: Address; reason?: string };

async function siweLogin(onStep?: Step): Promise<SiweOutcome> {
  onStep?.("Connect your wallet…");
  const address = await connectWallet(true);
  const nonce = await getNonce();
  onStep?.("Sign the message in your wallet…");
  const message = buildMessage({
    domain: window.location.host, address, uri: window.location.origin,
    chainId: CHAIN_ID, nonce,
    statement: "Sign in to Impact — proving you control this wallet.",
  });
  const signature = await personalSign(address, message);
  const r = await fetch("/connect/siwe", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, signature, aud: AUD }),
  });
  const body = await readJson<{ status?: string; token?: string; agent?: string }>(r);
  if (r.ok && body.status === "issued" && body.token) return { status: "issued", token: body.token, address, agent: (body.agent ?? address) as Address };
  if (r.ok && body.status === "bootstrap") return { status: "bootstrap", address };
  return { status: "rejected", address, reason: httpError(r, body) };
}

async function bootstrapWithWallet(address: Address, onStep?: Step): Promise<{ ok: true; agent: Address } | { ok: false; error: string }> {
  onStep?.("Preparing your home…");
  await ensureCsrfToken();
  const buildRes = await fetch("/a2a/session/deploy", {
    method: "POST", credentials: "include",
    headers: { "content-type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ initMethod: "eoa", owner: address }),
  });
  if (buildRes.status === 409) return { ok: false, error: "Gas sponsorship is not enabled on the backend (paymaster)." };
  const built = (await buildRes.json()) as { ok?: boolean; userOpHash?: Hex; userOp?: Record<string, unknown>; error?: string };
  if (!buildRes.ok || !built.ok || !built.userOpHash || !built.userOp) return { ok: false, error: built.error ?? `deploy build failed (HTTP ${buildRes.status})` };
  const signature = await personalSign(address, built.userOpHash);
  const submitRes = await fetch("/a2a/session/deploy/submit", {
    method: "POST", credentials: "include",
    headers: { "content-type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ userOp: { ...built.userOp, signature } }),
  });
  const submitted = (await submitRes.json()) as { ok?: boolean; deployedAddress?: Address; error?: string; detail?: string };
  if (!submitRes.ok || !submitted.ok || !submitted.deployedAddress) {
    return { ok: false, error: [submitted.error, submitted.detail].filter(Boolean).join(" — ") || `deploy submit failed (HTTP ${submitRes.status})` };
  }
  return { ok: true, agent: submitted.deployedAddress };
}

async function claimName(agent: Address, signHash: SignHash, base: string, minNonce?: bigint): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  const claim = await buildClaimCallData(base, agent);
  if (!claim.ok) return claim;
  const res = await executeCall(agent, signHash, claim.callData, { minNonce, attempts: 10 });
  if (!res.ok) return { ok: false, error: `name claim failed: ${res.error}` };
  return { ok: true, name: claim.name };
}

// ── Profile ──────────────────────────────────────────────────────────────────
export async function fetchProfile(token: string): Promise<BasicProfile | null> {
  const r = await fetch("/me/profile", { headers: { authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  return ((await r.json()) as { profile: BasicProfile }).profile;
}

/** "eip155:84532:0x…" | "0x…" → 0x… */
function addressOf(agent: string | null | undefined): Address {
  if (!agent) return "0x0000000000000000000000000000000000000000" as Address;
  const m = agent.match(/0x[0-9a-fA-F]{40}/);
  return (m?.[0] ?? agent) as Address;
}

async function finish(token: string, via: ConnectVia, fresh: boolean): Promise<ConnectResult> {
  const p = await fetchProfile(token);
  return {
    ok: true, token, via, fresh,
    address: addressOf(p?.agent),
    name: p?.name ?? null,
    deployed: p?.deployed ?? true,
  };
}

function sanitizeBase(nameHint?: string): string {
  const b = (nameHint || "").toLowerCase().replace(/\.(impact|demo\.agent)$/, "").replace(/[^a-z0-9-]/g, "");
  return b || "friend";
}

// ── High-level entry flows the UI calls ─────────────────────────────────────────
export async function connectPasskey(nameHint?: string, onStep?: Step): Promise<ConnectOutcome> {
  try {
    const login = await passkeyLogin(true, onStep);
    if (login.status === "issued") { onStep?.("Opening your home…"); return finish(login.token, "passkey", false); }
    if (login.status === "bootstrap") {
      const dep = await deployAndClaimPasskey(login.passkey, sanitizeBase(nameHint), onStep);
      if (!dep.ok) return { ok: false, error: dep.error };
      onStep?.("Signing you in…");
      const again = await passkeyLogin(false, onStep);
      if (again.status === "issued") return finish(again.token, "passkey", true);
      return { ok: false, error: `home secured, but sign-in returned ${again.status}` };
    }
    return { ok: false, error: login.reason ?? `passkey ${login.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "passkey connect failed" };
  }
}

// ── Social (Google / YouVersion) — OIDC redirect + code exchange ────────────────
// These redirect the whole page out to the broker's /oidc/<provider>/start, which
// bounces through the provider and back to `/?code=…&via=…`. The session provider
// then exchanges the code (exchangeCode) on return. Needs the OAuth client + (for a
// new home) the custody-bridge env configured — else /oidc/*/start returns 503.
export function startGoogleSignIn(): void {
  const u = new URL("/oidc/google/start", window.location.origin);
  u.searchParams.set("aud", AUD);
  u.searchParams.set("redirect_uri", window.location.origin + "/");
  window.location.assign(u.toString());
}

export function startYouVersionSignIn(): void {
  const u = new URL("/oidc/youversion/start", window.location.origin);
  u.searchParams.set("aud", AUD);
  u.searchParams.set("redirect_uri", window.location.origin + "/");
  window.location.assign(u.toString());
}

/** Exchange the single-use ?code delivered to the redirect for the AgentSession + profile. */
export async function exchangeCode(code: string, via: ConnectVia): Promise<ConnectOutcome> {
  try {
    const r = await fetch("/token", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, aud: AUD }),
    });
    const body = await readJson<{ agentSession?: string }>(r);
    if (!r.ok || !body.agentSession) return { ok: false, error: httpError(r, body) };
    return finish(body.agentSession, via, true);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "code exchange failed" };
  }
}

export async function connectWalletSiwe(nameHint?: string, onStep?: Step): Promise<ConnectOutcome> {
  try {
    const first = await siweLogin(onStep);
    if (first.status === "issued") { onStep?.("Opening your home…"); return finish(first.token, "wallet", false); }
    if (first.status === "bootstrap") {
      onStep?.("Securing your home on the network…");
      const dep = await bootstrapWithWallet(first.address, onStep);
      if (!dep.ok) return { ok: false, error: dep.error };
      rememberHomeEoa(sanitizeBase(nameHint), first.address);
      onStep?.("Claiming your name…");
      const signHash: SignHash = (h) => personalSign(first.address, h);
      await claimName(dep.agent, signHash, sanitizeBase(nameHint), 1n); // best-effort name
      onStep?.("Signing you in…");
      const again = await siweLogin(onStep);
      if (again.status === "issued") return finish(again.token, "wallet", true);
      return { ok: false, error: `home secured, but sign-in returned ${again.status}` };
    }
    return { ok: false, error: first.reason ?? `sign-in ${first.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "wallet connect failed" };
  }
}
