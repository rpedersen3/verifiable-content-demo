// Relying-app OIDC authorize ceremony — the CLIENT (SPA) half of the broker (spec 230).
//
// A registered relying app (bible-explorer / demo-corpus) redirects the browser to
//   https://www.churchcore.me/?client_id=&redirect_uri=&response_type=code&scope=openid agent
//     &state=&nonce=&code_challenge=<S256>&code_challenge_method=S256&agent_name=&delegate=
//     &delegation_template=site-login
// The home SPA (app/page.tsx → AuthorizeCeremony) parses those params, ensures the reader is
// connected, then: POST /oidc/authorize-grant → build+sign a site-login delegation (person SA →
// the REGISTRY delegate) → POST /oidc/grant → redirect back with ?code&state&ac_iss.
//
// The relying app then POSTs /token to exchange the code (PKCE) for { id_token, delegation }.
import { buildUnsignedSiteDelegation, toWire, type DelegationWire } from "@/lib/delegation";
import { signHashForVia, type ConnectVia } from "@/lib/connect";
import type { Address } from "@/lib/types";

export interface EnrollReq {
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
  /** agent_name — OPTIONAL (name-deferred connect). */
  name: string;
  delegationTemplate: string;
}

const PENDING_KEY = "impact.pendingEnroll";

/** Parse an inbound relying-app authorize request off the current URL. Returns null when this is
 *  NOT an authorize request (normal home load, or the social `?code` return), so the caller falls
 *  through to the normal landing. Lenient-when-absent / strict-when-present, mirroring the server
 *  (server/oidc/authorize-grant.ts). */
export function parseEnrollReq(): EnrollReq | null {
  if (typeof window === "undefined") return null;
  const q = new URLSearchParams(window.location.search);
  const clientId = q.get("client_id") ?? "";
  const redirectUri = q.get("redirect_uri") ?? "";
  const codeChallenge = q.get("code_challenge") ?? "";
  const delegationTemplate = q.get("delegation_template") ?? "";
  if (!clientId || !redirectUri || !codeChallenge || !delegationTemplate) return null;
  const responseType = q.get("response_type");
  if (responseType && responseType !== "code") return null;
  const ccm = q.get("code_challenge_method");
  if (ccm && ccm !== "S256") return null;
  return {
    clientId,
    redirectUri,
    state: q.get("state") ?? "",
    nonce: q.get("nonce") ?? "",
    codeChallenge,
    name: q.get("agent_name") ?? "",
    delegationTemplate,
  };
}

/** Social sign-in redirects the whole page to the IdP and returns to `/?code=…&via=…`, which the
 *  session provider consumes and strips the query — losing the authorize params. Stash them first
 *  so the ceremony can resume on return. Passkey/wallet run inline and never need this. */
export function stashPendingEnroll(enroll: EnrollReq): void {
  try { sessionStorage.setItem(PENDING_KEY, JSON.stringify(enroll)); } catch { /* ignore */ }
}
export function loadPendingEnroll(): EnrollReq | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as EnrollReq) : null;
  } catch { return null; }
}
export function clearPendingEnroll(): void {
  try { sessionStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
}

/** Phase 1 — server-mint the enrollment grant. Returns the grant_id + the REGISTRY delegate
 *  (SEC-001: use THIS delegate to build the delegation, never the URL's ?delegate hint). */
export async function beginEnrollmentGrant(
  enroll: EnrollReq,
  resolvedName: string,
): Promise<{ grant_id: string; delegate: Address }> {
  const r = await fetch("/oidc/authorize-grant", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: enroll.clientId,
      redirect_uri: enroll.redirectUri,
      code_challenge: enroll.codeChallenge,
      code_challenge_method: "S256",
      nonce: enroll.nonce,
      agent_name: resolvedName || enroll.name,
      delegation_template: enroll.delegationTemplate,
    }),
  });
  const b = (await r.json().catch(() => ({}))) as { grant_id?: string; delegate?: string; error?: string };
  if (!r.ok || !b.grant_id || !b.delegate) throw new Error(b.error || `authorize-grant failed (HTTP ${r.status})`);
  return { grant_id: b.grant_id, delegate: b.delegate as Address };
}

/** Build the unsigned site-login delegation (person SA → the registry delegate), sign its EIP-712
 *  digest with the reader's own credential (passkey/wallet on device; social via the a2a custody
 *  session — no held key), and return the wire form. Caveats match the server's verifier exactly. */
export async function issueSiteDelegation(
  personSA: Address,
  delegate: Address,
  via: ConnectVia,
  token?: string,
): Promise<DelegationWire> {
  const { delegation, digest } = buildUnsignedSiteDelegation(personSA, delegate);
  const signHash = await signHashForVia(via, personSA, token);
  delegation.signature = await signHash(digest);
  return toWire(delegation);
}

/** Phase 2 — redeem the grant + signed delegation for a single-use OIDC code. */
export async function submitEnrollGrant(grantId: string, delegation: DelegationWire): Promise<string> {
  const r = await fetch("/oidc/grant", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant_id: grantId, delegation }),
  });
  const b = (await r.json().catch(() => ({}))) as { code?: string; error?: string };
  if (!r.ok || !b.code) throw new Error(b.error || `grant failed (HTTP ${r.status})`);
  return b.code;
}

/** Deliver the code back to the relying app (full-page redirect). `ac_iss` is the minting origin,
 *  which the relying app uses for the /token exchange + id_token iss check (apex→<label> hop). */
export function deliverEnrollCode(enroll: EnrollReq, code: string): void {
  const url = new URL(enroll.redirectUri);
  url.searchParams.set("code", code);
  if (enroll.state) url.searchParams.set("state", enroll.state);
  url.searchParams.set("ac_iss", window.location.origin);
  window.location.href = url.toString();
}

/** Deliver a denial/error back to the relying app instead of a code. */
export function deliverEnrollError(enroll: EnrollReq, error: string): void {
  const url = new URL(enroll.redirectUri);
  url.searchParams.set("error", error);
  if (enroll.state) url.searchParams.set("state", enroll.state);
  window.location.href = url.toString();
}
