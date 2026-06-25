// Cross-principal ENTITLEMENTS — client side (spec 277). Custody ≠ access: an ORG grants a MEMBER
// (a different SA) scoped read access to the org's vault via a signed entitlement, enforced
// server-side. issue/list/revoke present the ORG's authority (its org→person stewardship delegation →
// impact-mcp recovers principal = the org). The member-read demo presents a MEMBER self-delegation
// (delegator = delegate = member, signed by the person who custodies it) → principal = member.

import type { Address } from "@agenticprimitives/types";
import { buildUnsignedSiteDelegation, toWire, type DelegationWire } from "./delegation";
import { signHashForVia, type ConnectVia } from "./connect";
import { ensureCsrfToken, csrfHeaders } from "../csrf";

const A2A = "/a2a";

export interface IssuedEntitlement {
  id: string;
  member: Address;
  resource: string;
  recordType: string;
  validUntil: string | null;
  status: "granted" | "revoked" | string;
  createdAt: string;
}

async function post(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  await ensureCsrfToken();
  const r = await fetch(`${A2A}/mcp/${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(body),
  });
  return (await r.json().catch(() => ({}))) as Record<string, unknown>;
}

/** The org's authority for issuer ops — present its stewardship grant (delegator = org). */
interface OrgAuthority { stewardship: DelegationWire; requester: Address }

export async function issueOrgEntitlement(
  auth: OrgAuthority,
  grant: { member: Address; recordType: string; fields?: string[]; ttlSeconds?: number; purpose?: string },
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const j = await post("entitlement/issue", {
    delegation: auth.stewardship,
    requester: auth.requester,
    subject: grant.member,
    recordType: grant.recordType,
    ...(grant.fields && grant.fields.length ? { fields: grant.fields } : {}),
    ...(typeof grant.ttlSeconds === "number" ? { ttlSeconds: grant.ttlSeconds } : {}),
    ...(grant.purpose ? { purpose: grant.purpose } : {}),
  });
  if (j.ok === true && typeof j.id === "string") return { ok: true, id: j.id };
  return { ok: false, error: [j.error, j.detail].filter(Boolean).join(" — ") || "issue failed" };
}

export async function listOrgEntitlements(auth: OrgAuthority): Promise<IssuedEntitlement[]> {
  const j = await post("entitlement/list", { delegation: auth.stewardship, requester: auth.requester });
  return Array.isArray(j.entitlements) ? (j.entitlements as IssuedEntitlement[]) : [];
}

export async function revokeOrgEntitlement(auth: OrgAuthority, id: string): Promise<{ ok: true; revoked: boolean } | { ok: false; error: string }> {
  const j = await post("entitlement/revoke", { delegation: auth.stewardship, requester: auth.requester, id });
  if (j.ok === true) return { ok: true, revoked: j.revoked === true };
  return { ok: false, error: [j.error, j.detail].filter(Boolean).join(" — ") || "revoke failed" };
}

/** Read an ORG's vault record AS a member, gated by the entitlement. Only works when the connected
 *  person CUSTODIES `member` (so we can sign the member's self-delegation) — i.e. the demonstrable
 *  case where the member is one of the person's own agents. Returns the data, or a denial reason. */
export async function readOrgAsMember(
  opts: { member: Address; via: ConnectVia; token?: string | null; owner: Address; recordType: string; fields?: string[] },
): Promise<{ ok: true; data: unknown; allowedFields: string[] | null } | { ok: false; error: string; reason?: string }> {
  // A fresh member→member session delegation, signed by the person as the member's custodian.
  const { delegation, digest } = buildUnsignedSiteDelegation(opts.member, opts.member, 60 * 30);
  try {
    const signHash = await signHashForVia(opts.via, opts.member, opts.token ?? undefined);
    delegation.signature = await signHash(digest);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "could not sign as the member (do you custody it?)" };
  }
  const j = await post("entitled/get", {
    delegation: toWire(delegation),
    requester: opts.member,
    owner: opts.owner,
    recordType: opts.recordType,
    ...(opts.fields && opts.fields.length ? { fields: opts.fields } : {}),
  });
  if (j.ok === true) return { ok: true, data: j.data ?? null, allowedFields: (j.allowedFields as string[] | null) ?? null };
  return { ok: false, error: [j.error, j.detail].filter(Boolean).join(" — ") || "read failed", reason: typeof j.reason === "string" ? j.reason : undefined };
}
