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
import { buildUnsignedSiteDelegation, buildUnsignedPaymentDelegation, toWire, type DelegationWire, type PaymentDelegationOpts } from "@/lib/delegation";
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
  /** x402-pay only: the tier price (atomic 6-dp USDC string) the reader is buying. */
  payAmount?: string;
  /** x402-pay subscription only: the period in seconds (present ⇒ mint a recurring pull mandate too). */
  subPeriod?: number;
  /** content-signer owner-op: the owner's id_token forwarded from the relying app (proves the caller
   *  is the corpus owner to the content service's admin endpoints). */
  collectToken?: string;
  /** content-signer owner-op: the specific issuer (agent name, e.g. qbsb.impact) to authorize. */
  contentSignerTarget?: string;
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
  const payAmount = q.get("pay_amount") || undefined;
  const subPeriodRaw = q.get("sub_period");
  return {
    clientId,
    redirectUri,
    state: q.get("state") ?? "",
    nonce: q.get("nonce") ?? "",
    codeChallenge,
    name: q.get("agent_name") ?? "",
    delegationTemplate,
    payAmount,
    subPeriod: subPeriodRaw ? Number(subPeriodRaw) : undefined,
    collectToken: q.get("collect_token") || undefined,
    contentSignerTarget: q.get("content_signer_target") || undefined,
  };
}

/** Social sign-in redirects the whole page to the IdP and returns to `/?code=…&via=…`, which the
 *  session provider consumes and strips the query — losing the authorize params. Stash them first
 *  so the ceremony can resume on return. Passkey/wallet run inline and never need this. */
// The stash only needs to survive the social IdP full-page round-trip (seconds to ~a minute).
// A freshness bound prevents an abandoned in-flight auth from hijacking a LATER visit to the home.
const PENDING_TTL_MS = 5 * 60_000;

export function stashPendingEnroll(enroll: EnrollReq): void {
  try { sessionStorage.setItem(PENDING_KEY, JSON.stringify({ enroll, ts: Date.now() })); } catch { /* ignore */ }
}
export function loadPendingEnroll(): EnrollReq | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as { enroll?: EnrollReq; ts?: number };
    if (!p?.enroll || typeof p.ts !== "number" || Date.now() - p.ts > PENDING_TTL_MS) {
      sessionStorage.removeItem(PENDING_KEY);
      return null;
    }
    return p.enroll;
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

/** Build + sign an x402 payment delegation (payer treasury → delegate). Signed with the TREASURY's
 *  credential — ERC-1271 verifies against the treasury SA, so `sender` MUST be the treasury (the
 *  reader's `via`/`token` custody controls both their person SA and the treasury). */
export async function issuePaymentDelegation(
  treasury: Address,
  delegate: Address,
  payee: Address,
  via: ConnectVia,
  token: string | undefined,
  opts: PaymentDelegationOpts,
): Promise<DelegationWire> {
  const { delegation, digest } = buildUnsignedPaymentDelegation(treasury, delegate, payee, opts);
  const signHash = await signHashForVia(via, treasury, token);
  delegation.signature = await signHash(digest);
  return toWire(delegation);
}

/** Phase 2 — redeem the grant + signed delegation for a single-use OIDC code. */
export async function submitEnrollGrant(
  grantId: string,
  delegation: DelegationWire,
  extra?: { paymentDelegation?: DelegationWire; pullDelegation?: DelegationWire; settlementHash?: string; treasury?: string },
): Promise<string> {
  const r = await fetch("/oidc/grant", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant_id: grantId, delegation, ...(extra ?? {}) }),
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

// ── content-signer owner-op (spec 266) ──
// The corpus OWNER authorizes each content issuer's Cloud-KMS signing key: signs, with their own
// credential, a delegation binding the issuer SA (e.g. qbsb.impact) → its KMS key address; the content
// service stores it. No held key — the KMS key never leaves the HSM. Scoped to the issuer the owner
// custodies (targetSigner). Returns how many keys were authorized.
export async function authorizeContentSigningForOwner(
  via: ConnectVia,
  token: string | undefined,
  opts: { a2aBase: string; idToken: string; targetSigner?: string },
): Promise<{ ok: true; attempted: number; authorized: number } | { ok: false; error: string }> {
  const base = opts.a2aBase.replace(/\/$/, "");
  const keysRes = (await fetch(`${base}/admin/content-signer-keys`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id_token: opts.idToken }),
  }).then((r) => r.json()).catch(() => ({ ok: false }))) as {
    ok?: boolean;
    signers?: Array<{ issuerName: string; issuerSa: Address; delegateKey: Address }>;
    error?: string;
  };
  if (!keysRes.ok) return { ok: false, error: keysRes.error ?? "could not read content-signer keys" };
  const all = keysRes.signers ?? [];
  const signers = opts.targetSigner
    ? all.filter((s) => s.issuerName.toLowerCase() === opts.targetSigner!.toLowerCase())
    : all;
  if (opts.targetSigner && signers.length === 0) {
    return { ok: false, error: `signing identity ${opts.targetSigner} has no provisioned key yet` };
  }
  const oneYear = 365 * 24 * 60 * 60;
  let authorized = 0;
  for (const s of signers) {
    try {
      // Sign AS the issuer SA (the owner custodies it): the single-leaf ROOT delegation binds
      // issuerSa → its KMS key address, so the KMS key may sign content descriptors AS the issuer.
      const { delegation, digest } = buildUnsignedSiteDelegation(s.issuerSa, s.delegateKey, oneYear);
      const signHash = await signHashForVia(via, s.issuerSa, token);
      delegation.signature = await signHash(digest);
      const stored = (await fetch(`${base}/admin/store-content-signer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id_token: opts.idToken,
          issuerName: s.issuerName,
          issuerSa: s.issuerSa,
          delegateKey: s.delegateKey,
          delegationLeaf: toWire(delegation),
        }),
      }).then((r) => r.json()).catch(() => ({ ok: false }))) as { ok?: boolean; error?: string };
      if (stored.ok) authorized++;
    } catch {
      /* per-issuer failure — counted as not authorized */
    }
  }
  return { ok: true, attempted: signers.length, authorized };
}

/** Deliver an owner-op result (content-signer / collect) back to the relying app: `?collect=1&…`. */
export function deliverCollectResult(
  enroll: EnrollReq,
  r: { authorized: number; attempted: number },
  kind = "content-signer",
): void {
  const url = new URL(enroll.redirectUri);
  url.searchParams.set("collect", "1");
  url.searchParams.set("collected", String(r.authorized));
  url.searchParams.set("attempted", String(r.attempted));
  url.searchParams.set("collect_kind", kind);
  if (enroll.state) url.searchParams.set("state", enroll.state);
  window.location.href = url.toString();
}
