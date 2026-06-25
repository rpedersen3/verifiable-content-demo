// Delegation-presented vault access (spec 246/270/278). Custody ≠ access: a vault read/write is
// authorized by a DELEGATION the caller holds (and, server-side, an ENTITLEMENT), NEVER by naming a
// principal we control. The client presents a signed delegation to impact-a2a's /mcp/vault/* routes;
// a2a verifies it (ERC-1271/6492 + revocation + caveats), mints an MCP token with `sub = the
// delegation's DELEGATOR`, and impact-mcp keys the record by that owner + gates on the entitlement
// (owner-self for own data). This REPLACES the old mintToken(principal) shortcut on /mcp-bind/oauth.
//
//  • SELF  — read/write your OWN vault: present a person→person session delegation you sign with your
//            home credential (the signed delegation is the read authority). Cached ~12h so a passkey
//            home signs at most once per session; social homes sign gesture-free via C_sub.
//  • ORG   — read/write an org's vault as its custodian: present the STEWARDSHIP delegation
//            (delegator = org, delegate = you) captured at org creation → `sub = org`.
//
// Ported in spirit from agenticprimitives/demo-sso-next vault-client.ts + issueSessionDelegation.

import type { Address } from "@agenticprimitives/types";
import { buildUnsignedSiteDelegation, toWire, type DelegationWire } from "./delegation";
import { signHashForVia, type ConnectVia } from "./connect";
import { ensureCsrfToken, csrfHeaders } from "../csrf";

/** Raised when the SUBJECT (person or org) has no vault-key binding yet — its vault isn't activated.
 *  Defined here (the access layer) and re-exported by the stores so existing imports keep working. */
export class VaultKeyUnauthorizedError extends Error {
  constructor() {
    super("vault_key_unauthorized");
    this.name = "VaultKeyUnauthorizedError";
  }
}

/** Whose vault we're touching, and the delegation that authorizes it. */
export type AccessContext =
  | { kind: "self"; personSA: Address; via: ConnectVia; token?: string | null }
  | { kind: "org"; orgSA: Address; requester: Address; stewardship: DelegationWire };

const A2A = "/a2a";
const SELF_VALIDITY_SECONDS = 60 * 60 * 12; // 12h, matches demo-sso-next session delegation
const CACHE_PREFIX = "impact.self-delegation.v1:";

interface CachedSelf { wire: DelegationWire; expiresAt: number }
const memCache = new Map<string, CachedSelf>();

function loadCachedSelf(key: string): CachedSelf | null {
  const hit = memCache.get(key);
  if (hit) return hit;
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const c = JSON.parse(raw) as CachedSelf;
    memCache.set(key, c);
    return c;
  } catch { return null; }
}

function saveCachedSelf(key: string, c: CachedSelf): void {
  memCache.set(key, c);
  try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(c)); } catch { /* ignore */ }
}

function clearCachedSelf(key: string): void {
  memCache.delete(key);
  try { localStorage.removeItem(CACHE_PREFIX + key); } catch { /* ignore */ }
}

/** True iff a still-valid self session-delegation is already cached for this person — i.e. a read
 *  can be served WITHOUT a fresh signing gesture. Background/non-essential surfaces (the topbar name
 *  fetch) check this so they never trigger an unexpected passkey prompt. */
export function hasCachedSelfDelegation(personSA: Address): boolean {
  const c = loadCachedSelf(personSA.toLowerCase());
  return !!c && c.expiresAt > Date.now() + 60_000;
}

/** A person→person session delegation the member signs with their home credential, authorizing reads
 *  of their OWN vault. Cached until ~1min before expiry; `forceFresh` re-signs (used after the server
 *  reports the presented delegation expired/invalid). */
async function getSelfDelegation(
  ctx: Extract<AccessContext, { kind: "self" }>,
  forceFresh: boolean,
): Promise<DelegationWire> {
  const key = ctx.personSA.toLowerCase();
  if (!forceFresh) {
    const cached = loadCachedSelf(key);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.wire;
  }
  const { delegation, digest } = buildUnsignedSiteDelegation(ctx.personSA, ctx.personSA, SELF_VALIDITY_SECONDS);
  const signHash = await signHashForVia(ctx.via, ctx.personSA, ctx.token ?? undefined);
  delegation.signature = await signHash(digest);
  const wire = toWire(delegation);
  saveCachedSelf(key, { wire, expiresAt: Date.now() + SELF_VALIDITY_SECONDS * 1000 });
  return wire;
}

async function presentDelegation(
  ctx: AccessContext,
  forceFresh: boolean,
): Promise<{ delegation: DelegationWire; requester: Address }> {
  if (ctx.kind === "org") return { delegation: ctx.stewardship, requester: ctx.requester };
  return { delegation: await getSelfDelegation(ctx, forceFresh), requester: ctx.personSA };
}

interface VaultResponse { ok?: boolean; error?: string; detail?: string; data?: unknown }

async function callVaultRoute(path: "get" | "set" | "list", body: Record<string, unknown>): Promise<{ httpOk: boolean; json: VaultResponse }> {
  await ensureCsrfToken();
  const r = await fetch(`${A2A}/mcp/vault/${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(body),
  });
  const json = (await r.json().catch(() => ({}))) as VaultResponse;
  return { httpOk: r.ok, json };
}

function isVaultKeyUnauthorized(j: VaultResponse): boolean {
  return j.error === "vault_key_unauthorized" || (typeof j.detail === "string" && j.detail.includes("vault_key_unauthorized"));
}

function isDelegationInvalid(j: VaultResponse): boolean {
  return j.error === "delegation_invalid" || j.error === "session_resolve_no_delegation";
}

/** Read a generic JSON vault record (`vault:<recordType>`) for the access subject, over a presented
 *  delegation. Returns null if the record was never written. Throws `VaultKeyUnauthorizedError` if the
 *  subject's vault isn't activated. */
export async function readVaultRecord<T = unknown>(ctx: AccessContext, recordType: string): Promise<T | null> {
  let attempt = 0;
  // For self, a single retry with a fresh delegation covers a silently-expired cached one.
  while (true) {
    const { delegation, requester } = await presentDelegation(ctx, attempt > 0);
    const { json } = await callVaultRoute("get", { delegation, requester, recordType });
    if (isVaultKeyUnauthorized(json)) throw new VaultKeyUnauthorizedError();
    if (isDelegationInvalid(json) && ctx.kind === "self" && attempt === 0) {
      clearCachedSelf(ctx.personSA.toLowerCase());
      attempt += 1;
      continue;
    }
    if (json.ok === false) throw new Error([json.error, json.detail].filter(Boolean).join(" — ") || "vault read failed");
    return (json.data ?? null) as T | null;
  }
}

/** Write a generic JSON vault record for the access subject, over a presented delegation. */
export async function writeVaultRecord(ctx: AccessContext, recordType: string, data: unknown): Promise<void> {
  let attempt = 0;
  while (true) {
    const { delegation, requester } = await presentDelegation(ctx, attempt > 0);
    const { json } = await callVaultRoute("set", { delegation, requester, recordType, data });
    if (isVaultKeyUnauthorized(json)) throw new VaultKeyUnauthorizedError();
    if (isDelegationInvalid(json) && ctx.kind === "self" && attempt === 0) {
      clearCachedSelf(ctx.personSA.toLowerCase());
      attempt += 1;
      continue;
    }
    if (json.ok !== true) throw new Error([json.error, json.detail].filter(Boolean).join(" — ") || "vault write failed");
    return;
  }
}
