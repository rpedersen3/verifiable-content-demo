// Real connect — passkey (WebAuthn) + SIWE (wallet) sign-in/bootstrap against the
// live impact-a2a relayer + the ported broker routes (/connect/*, /me). Ported from
// agenticprimitives/impact/src/connect-client.ts, trimmed to the sign-in
// substrate (no org/delegation/treasury/payment surface). Social (Google/YouVersion)
// is wired separately and needs the custody-bridge env.
import { encodeFunctionData, parseUnits } from "viem";
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
  type Passkey,
} from "./passkey";
import { ensureCsrfToken, csrfHeaders } from "../csrf";
import { CONTRACTS, DEFAULT_RPC_URL } from "./chain";
import { nameLabel } from "./domain";
import { buildApprovedSiteDelegation, toWire, type DelegationWire } from "./delegation";
import { upsertRelationship, type AgentRelationship } from "./relationships-store";
import type { AccessContext } from "./access";

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
  const hostname = typeof window !== "undefined" ? window.location.hostname : "www.churchcore.me";
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(hostname));
  const arr = Array.from(new Uint8Array(buf));
  return ("0x" + arr.map((b) => b.toString(16).padStart(2, "0")).join("")) as Hex;
}

async function derivePasskeySa(passkey: Passkey, salt: bigint): Promise<Address> {
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
  extraCalls: ContractCall[] = [],
): Promise<{ ok: true; callData: Hex; name: string } | { ok: false; error: string }> {
  const picked = (await (await fetch(`/connect/name?base=${encodeURIComponent(base)}`)).json()) as {
    label?: string; name?: string; node?: Hex; error?: string;
  };
  if (!picked.name || !picked.node || !picked.label) return { ok: false, error: picked.error ?? "no free name" };
  const register = buildSubregistryRegisterCall({ subregistry: CONTRACTS.permissionlessSubregistry, label: picked.label, newOwner: sa });
  const setPrimary = buildSetPrimaryNameCall({ registry: CONTRACTS.agentNameRegistry, node: picked.node });
  const calls: ContractCall[] = [register, setPrimary, ...extraCalls];
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
  | { status: "issued"; token: string; passkey: Passkey }
  | { status: "bootstrap"; passkey: Passkey }
  | { status: "rejected"; passkey?: Passkey; reason?: string };

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
  // rpIdHash is part of the passkey SA's CREATE2 address (the deploy bakes sha256 of THIS
  // browser's host). Send the same value so the server resolves the exact deployed SA —
  // server-side Host derivation can drift behind a proxy/alias and miss the account.
  const rpIdHash = await derivePasskeyRpIdHash();
  const r = await fetch("/connect/passkey", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      credentialIdDigest: passkey.credentialIdDigest,
      pubKeyX: passkey.pubKeyX.toString(), pubKeyY: passkey.pubKeyY.toString(),
      rpIdHash, challenge, signature, aud: AUD,
    }),
  });
  const body = await readJson<{ status?: string; token?: string }>(r);
  if (r.ok && body.status === "issued" && body.token) return { status: "issued", token: body.token, passkey };
  if (r.ok && body.status === "bootstrap") return { status: "bootstrap", passkey };
  return { status: "rejected", passkey, reason: httpError(r, body) };
}

/** Deploy a passkey-direct SA via the relayer; `callData` (name claim) rides in the deploy op. */
async function bootstrapWithPasskey(passkey: Passkey, callData?: Hex, onStep?: Step, salt?: bigint): Promise<{ ok: true; agent: Address } | { ok: false; error: string }> {
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
      rpIdHash, ...(salt !== undefined ? { salt: salt.toString() } : {}), ...(callData ? { callData } : {}),
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

async function deployAndClaimPasskey(passkey: Passkey, base: string, onStep?: Step): Promise<{ ok: true; agent: Address; name: string } | { ok: false; error: string }> {
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
  const b = (nameHint || "").toLowerCase().replace(/\.impact$/, "").replace(/[^a-z0-9-]/g, "");
  return b || "friend";
}

// ── High-level entry flows the UI calls ─────────────────────────────────────────
export async function connectPasskey(nameHint?: string, onStep?: Step): Promise<ConnectOutcome> {
  try {
    const login = await passkeyLogin(true, onStep);
    if (login.status === "issued") { onStep?.("Opening your home…"); return finish(login.token, "passkey", false); }
    if (login.status === "bootstrap") {
      // Guard: only deploy if the SA truly isn't on-chain yet. If it IS deployed, the
      // bootstrap was a false negative (e.g. a stale reconnect) — re-deploying the same SA
      // reverts with EntryPoint AA25. Skip straight to sign-in instead. The derived address
      // includes rpIdHash, so it matches what the deploy created.
      const sa = await derivePasskeySa(login.passkey, 0n);
      const alreadyDeployed = await agentAccountClient().isDeployed(sa).catch(() => false);
      if (!alreadyDeployed) {
        const base = nameHint && nameHint.trim() ? sanitizeBase(nameHint) : null;
        if (base) {
          const dep = await deployAndClaimPasskey(login.passkey, base, onStep);
          if (!dep.ok) return { ok: false, error: dep.error };
        } else {
          // No name given → secure a NAMELESS home (deploy with no name claim). The member
          // can claim a public name later. (spec 257 name-deferral.)
          onStep?.("Securing your home (no name yet)…");
          const dep = await bootstrapWithPasskey(login.passkey, undefined, onStep);
          if (!dep.ok) return { ok: false, error: dep.error };
        }
      }
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
      const base = nameHint && nameHint.trim() ? sanitizeBase(nameHint) : null;
      if (base) {
        rememberHomeEoa(base, first.address);
        onStep?.("Claiming your name…");
        const signHash: SignHash = (h) => personalSign(first.address, h);
        await claimName(dep.agent, signHash, base, 1n); // best-effort name
      } // else → nameless home (claim a name later)
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

// ── Personal treasury (spec 283/284) ────────────────────────────────────────────
// A person's "money agent" is a SEPARATE Smart Agent named `<handle>-treasury.impact`, so funds
// live apart from the identity SA. Passkey homes deploy it at salt 1 under the same passkey; social
// (Google/YouVersion) homes deploy it server-side custodied by the per-(iss,sub) C_sub, parented to
// the person SA. Detection + live balance is `usePersonTreasury` (src/lib/use-live.ts).

const MINT_ABI = [{ type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] }] as const;

/** spec 253 — `ApprovedHashRegistry.approveHash(digest)`. Batched into the delegator agent's deploy
 *  userOp so it pre-approves its own outbound grant's digest; the grant then validates via the
 *  agent SA's ERC-1271 `0x03` approved-hash branch (no second signature). */
const APPROVE_HASH_ABI = [{ type: "function", name: "approveHash", stateMutability: "nonpayable", inputs: [{ name: "hash", type: "bytes32" }], outputs: [] }] as const;
function buildApproveHashCall(digest: Hex): ContractCall {
  return { to: CONTRACTS.approvedHashRegistry as Address, value: 0n, data: encodeFunctionData({ abi: APPROVE_HASH_ABI, functionName: "approveHash", args: [digest] }) };
}

const REVOKE_DELEGATION_ABI = [
  {
    type: "function", name: "revokeDelegationByOwner", stateMutability: "nonpayable", outputs: [],
    inputs: [{
      name: "delegation", type: "tuple", components: [
        { name: "delegator", type: "address" },
        { name: "delegate", type: "address" },
        { name: "authority", type: "bytes32" },
        { name: "caveats", type: "tuple[]", components: [{ name: "enforcer", type: "address" }, { name: "terms", type: "bytes" }, { name: "args", type: "bytes" }] },
        { name: "salt", type: "uint256" },
        { name: "signature", type: "bytes" },
      ],
    }],
  },
] as const;

/** Persist a person→agent link (+ its read delegations) into the home vault via the
 *  session-authorized POST /connect/related-orgs. Best-effort: the agent is already deployed,
 *  so a save failure is surfaced but non-fatal to the deploy. */
/** Record a person→agent relationship in the PERSON'S VAULT (vault:impact-relationships), over a
 *  presented self delegation — durable, custody-independent, trust-ontology-modelled. Replaces the
 *  old broker-KV /connect/related-orgs write (the ephemeral store that lost data on every deploy). */
async function saveRelatedAgent(input: {
  person: Address; orgAgent: Address; orgName: string; purpose: string; kind: string; parent: Address;
  stewardshipDelegation?: DelegationWire; via: ConnectVia; token: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const ctx: AccessContext = { kind: "self", personSA: input.person, via: input.via, token: input.token };
    const kind = input.kind as AgentRelationship["kind"];
    const relation: AgentRelationship["relation"] =
      kind === "person-treasury" || kind === "org" || kind === "org-treasury" ? "steward" : "peer";
    await upsertRelationship(ctx, {
      agent: input.orgAgent,
      agentName: input.orgName?.trim() || null,
      kind,
      relation,
      purpose: input.purpose ?? "",
      parent: input.parent ?? input.person,
      createdAt: Date.now(),
      grants: { stewardship: input.stewardshipDelegation ?? null },
      attestation: { type: "gc:Attestation", confidence: 1.0, method: "self-issued", basis: "person deployed and stewards this agent" },
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "could not save the relationship to your vault" };
  }
}

/** Revoke a delegation the person granted (ADR-0019: a grant is a revocable scoped delegation).
 *  The DELEGATOR SA — an agent the person controls (their treasury / the person SA) — signs
 *  `execute(DelegationManager, revokeDelegationByOwner(d))`, so `msg.sender` is the delegator and
 *  the authenticated gate passes. After it lands, the delegation is revoked and the grantee's
 *  access is gone. The home credential (`via` + custody `token`) custodies the delegator SA. */
export async function revokeDelegation(
  opts: { wire: DelegationWire; via: ConnectVia; token?: string },
  onStep?: Step,
): Promise<{ ok: true; txHash?: Hex } | { ok: false; error: string }> {
  const d = opts.wire;
  let signHash: SignHash;
  try { signHash = await signHashForVia(opts.via, d.delegator, opts.token); }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : "could not set up signing" }; }
  const onchain = {
    delegator: d.delegator, delegate: d.delegate, authority: d.authority,
    caveats: d.caveats.map((c) => ({ enforcer: c.enforcer, terms: c.terms, args: c.args ?? "0x" })),
    salt: BigInt(d.salt), signature: d.signature,
  } as const;
  const inner = encodeFunctionData({ abi: REVOKE_DELEGATION_ABI, functionName: "revokeDelegationByOwner", args: [onchain] });
  const callData = buildExecuteBatchCallData([{ to: CONTRACTS.delegationManager as Address, value: 0n, data: inner } as ContractCall]);
  onStep?.("Revoking — confirm with your home credential…");
  return executeCall(d.delegator, signHash, callData, { attempts: 5 });
}

/** A SignHash for the home's credential — passkey/wallet sign on device; social homes sign via the
 *  per-(iss,sub) custody session (no device gesture). `sender` is the SA the signature must validate
 *  against (ERC-1271) — the person SA for self grants, an SA the session custodies for managed ones. */
export async function signHashForVia(via: ConnectVia, sender: Address, token?: string): Promise<SignHash> {
  if (via === "wallet") {
    const addr = await connectWallet(true);
    return (h) => personalSign(addr, h);
  }
  if (via === "google" || via === "youversion") {
    if (!token) throw new Error("Signing from a social home needs a live custody session — sign in again.");
    return async (hash: Hex): Promise<Hex> => {
      await ensureCsrfToken();
      const r = await fetch("/a2a/custody/google/sign", {
        method: "POST", credentials: "include",
        headers: { "content-type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ session: token, hash, sender }),
      });
      const b = (await r.json().catch(() => ({}))) as { ok?: boolean; signature?: Hex; error?: string; detail?: string };
      if (!r.ok || !b.ok || !b.signature) throw new Error([b.error, b.detail].filter(Boolean).join(" — ") || `custody sign failed (HTTP ${r.status})`);
      return b.signature;
    };
  }
  return passkeySignHash;
}

export type ManagedKind = "person-treasury" | "org" | "org-treasury";

/** Passkey deploy salt for a managed agent (ADR-0010: a DISTINCT non-zero salt, NEVER name-derived).
 *  The person SA is salt 0 and the treasury its singleton salt 1; an org/org-treasury (many per home)
 *  gets a fresh RANDOM salt so distinct agents get distinct SAs — same as a2a's server-side bootstrap. */
function managedSalt(kind: ManagedKind): bigint {
  if (kind === "person-treasury") return 1n;
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let salt = 0n;
  for (const b of bytes) salt = (salt << 8n) | BigInt(b);
  return salt === 0n ? 1n : salt;
}

/** Deploy a person-governed managed agent (gas-sponsored) — a treasury, an organization, or an
 *  org treasury. NAME-AWARE (ADR-0010): a NAMED agent claims `<label>.impact`; a nameless one
 *  deploys with the SA as its canonical id. Either way it's recorded in the home vault under its
 *  `kind` with a stewardship grant agent→parent, so it's detected from the vault, not the name. */
export async function createManagedAgent(
  opts: { name: string | null; kind: ManagedKind; nameSuffix?: string; purpose?: string; parent?: Address; personSA: Address; via: ConnectVia; token?: string },
  onStep?: Step,
): Promise<{ ok: true; agent: Address; name: string } | { ok: false; error: string }> {
  const suffix = opts.nameSuffix ?? "";
  const label = opts.name && opts.name.trim() ? nameLabel(opts.name) : null;
  const base = label ? `${label}${suffix}` : null;
  const parent = opts.parent ?? opts.personSA;
  const purpose = opts.purpose ?? opts.kind;
  const noun = opts.kind === "org" ? "organization" : "treasury";

  if (opts.via === "google" || opts.via === "youversion") {
    if (!opts.token) return { ok: false, error: "needs a live custody session — sign in again." };
    // Reserve a free name ONLY when the agent is named; otherwise deploy nameless.
    let pick: { label?: string; name?: string; node?: Hex } = {};
    if (base) {
      onStep?.(`Reserving your ${noun} name…`);
      const p = (await (await fetch(`/connect/name?base=${encodeURIComponent(base)}`)).json()) as { label?: string; name?: string; node?: Hex; error?: string };
      if (!p.label || !p.node || !p.name) return { ok: false, error: p.error ?? "no free name" };
      pick = p;
    }
    await ensureCsrfToken();
    onStep?.(`Deploying your ${noun} (gas-free)…`);
    const res = await fetch("/a2a/custody/google/bootstrap-agent", {
      method: "POST", credentials: "include",
      headers: { "content-type": "application/json", ...csrfHeaders() },
      body: JSON.stringify({ session: opts.token, kind: opts.kind, parent, ...(pick.label && pick.node ? { label: pick.label, node: pick.node } : {}) }),
    });
    const b = (await res.json().catch(() => ({}))) as { ok?: boolean; agent?: Address; stewardshipDelegation?: DelegationWire; error?: string; detail?: string };
    if (!res.ok || !b.ok || !b.agent) return { ok: false, error: [b.error, b.detail].filter(Boolean).join(" — ") || `${noun} deploy failed (HTTP ${res.status})` };
    // Record the agent (+ its stewardship grant agent→parent) in the home vault so it surfaces live
    // (Organizations / Vault Delegations) AND is how it's detected. The endpoint mints the grant.
    onStep?.(`Saving your ${noun} to your vault…`);
    await saveRelatedAgent({
      person: opts.personSA, orgAgent: b.agent, orgName: pick.name ?? "", purpose,
      kind: opts.kind, parent, stewardshipDelegation: b.stewardshipDelegation, via: opts.via, token: opts.token,
    });
    return { ok: true, agent: b.agent, name: pick.name ?? "" };
  }
  if (opts.via === "passkey") {
    const passkey = loadPasskey();
    if (!passkey) return { ok: false, error: "Your passkey isn't on this device. Reconnect, then try again." };
    onStep?.(base ? `Reserving your ${noun} name…` : `Preparing your ${noun}…`);
    const salt = managedSalt(opts.kind);
    const sa = await derivePasskeySa(passkey, salt);
    // Stewardship grant agent→parent, pre-approved (0x03 sentinel) INSIDE the deploy batch so the
    // parent can read/oversee the agent — no second signature (spec 246/253).
    const stewardship = buildApprovedSiteDelegation(sa, parent);
    const approve = buildApproveHashCall(stewardship.digest);
    let callData: Hex;
    let agentName = "";
    if (base) {
      const claim = await buildClaimCallData(base, sa, [approve]);
      if (!claim.ok) return { ok: false, error: claim.error };
      callData = claim.callData; agentName = claim.name;
    } else {
      callData = buildExecuteBatchCallData([approve as ContractCall]);
    }
    onStep?.(`Deploying your ${noun} (gas-free)…`);
    const dep = await bootstrapWithPasskey(passkey, callData, onStep, salt);
    if (!dep.ok) return dep;
    if (opts.token) {
      onStep?.(`Saving your ${noun} to your vault…`);
      await saveRelatedAgent({
        person: opts.personSA, orgAgent: dep.agent, orgName: agentName, purpose,
        kind: opts.kind, parent, stewardshipDelegation: toWire(stewardship.delegation), via: opts.via, token: opts.token,
      });
    }
    return { ok: true, agent: dep.agent, name: agentName };
  }
  return { ok: false, error: `Creating a ${noun} from a wallet home isn't wired yet — use a passkey or social home.` };
}

/** The person's money agent: `<home-label>-treasury.impact`, kind person-treasury. */
export function createPersonTreasury(
  opts: { name: string | null; personSA: Address; via: ConnectVia; token?: string },
  onStep?: Step,
) {
  return createManagedAgent({ ...opts, kind: "person-treasury", nameSuffix: "-treasury", purpose: "treasury" }, onStep);
}

/** A person-governed organization: `<org-label>.impact`, kind org, stewarded by the person. */
export function createOrg(
  opts: { name: string; personSA: Address; via: ConnectVia; token?: string },
  onStep?: Step,
) {
  return createManagedAgent({ ...opts, kind: "org", purpose: "org" }, onStep);
}

/** Mint mock USDC into a treasury (testnet faucet) via the person SA's relayer-sponsored call. */
export async function fundTreasury(
  opts: { treasury: Address; usdc: number; personSA: Address; via: ConnectVia; token?: string },
  onStep?: Step,
): Promise<{ ok: true; txHash?: Hex } | { ok: false; error: string }> {
  if (!(opts.usdc > 0)) return { ok: false, error: "Enter an amount greater than 0." };
  const amount = parseUnits(String(opts.usdc), 6);
  let signHash: SignHash;
  try { signHash = await signHashForVia(opts.via, opts.personSA, opts.token); }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : "could not set up signing" }; }
  onStep?.(`Funding ${opts.usdc} USDC…`);
  const mintData = encodeFunctionData({ abi: MINT_ABI, functionName: "mint", args: [opts.treasury, amount] });
  const callData = buildExecuteBatchCallData([{ to: CONTRACTS.mockUsdc as Address, value: 0n, data: mintData } as ContractCall]);
  return executeCall(opts.personSA, signHash, callData, { attempts: 6 });
}
