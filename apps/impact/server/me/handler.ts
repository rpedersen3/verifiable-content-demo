// GET /me/profile      → basic profile (any valid AgentSession; login-grade OK)
// GET /me/sensitive    → sensitive PII (custody-grade only; else 403 step-up)
//
// The "person MCP": served from the Connect origin, it verifies the
// SAME-origin AgentSession against the broker's published JWKS (connect's
// importJwks + verifyAgentSession — app-layer verify per spec 227 §7/U1), then
// gates on the session's assurance (P1-E). Token via `Authorization: Bearer` or
// `?token=`. Exact `aud` match (P1-F); fail-closed everywhere.
import { importJwks, verifyAgentSession } from '@agenticprimitives/connect';
import { AgentAccountClient } from '@agenticprimitives/agent-account';
import { toCanonicalAgentId } from '@agenticprimitives/identity-directory-adapters';
import type { Address } from '@agenticprimitives/types';
import { getServer, json, type FnContext } from '../_lib/server-broker';
import { basicProfile, sensitivePii } from '../../src/lib/pii';
import { CONNECT_DOMAIN } from '../../src/lib/domain';
import { CHAIN_ID, CONTRACTS, DEFAULT_RPC_URL } from '../../src/lib/chain';

/** Extract the SA address from a subject that may be CAIP-10 (`eip155:<chain>:0x…`) OR a bare
 *  `0x…` address. Permissive on purpose: `directory.agent()` REQUIRES a canonical eip155 id and
 *  throws on a bare address, which would otherwise be swallowed into a nameless home. */
function addressFromSub(sub: string | undefined): Address | null {
  const m = sub?.match(/0x[0-9a-fA-F]{40}/);
  return (m?.[0] as Address) ?? null;
}

/** The person MCP's own audience — MUST match the aud the connect client mints with
 *  (src/lib/connect.ts AUD). Impact uses 'impact'. */
const AUD = 'impact';

/**
 * Is `origin` one of THIS site's own Connect origins (ADR-0021 app policy)? The apex + per-handle
 * `https://<label>.<CONNECT_DOMAIN>` homes (spec 232). A Google session is minted on the central
 * origin (the Google callback runs there) but consumed on the member's subdomain — same broker
 * key + JWKS, same registrable domain — so its `iss` is trusted here even when it isn't the exact
 * request origin. https + a single DNS label only.
 */
function isOwnConnectOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    if (u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase();
    if (h === CONNECT_DOMAIN) return true;
    const sfx = '.' + CONNECT_DOMAIN;
    return h.endsWith(sfx) && /^[a-z0-9-]+$/.test(h.slice(0, -sfx.length));
  } catch {
    return false;
  }
}

export const onRequestGet = async ({ request, env }: FnContext): Promise<Response> => {
  const url = new URL(request.url);
  const iss = url.origin; // the Connect origin that issued the token
  const bearer = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const token = bearer || url.searchParams.get('token') || '';
  if (!token) return json({ error: 'AgentSession bearer token required' }, 401);

  const { jwks, directory } = await getServer(env);
  const keys = await importJwks(jwks);

  // Verify signature/alg/aud/exp/owner (the alg-pin rejects HS256 BrokerSession tokens), then
  // accept the issuer if it's the request origin OR one of our own Connect origins — a Google
  // session is minted on the central origin but consumed on the member's per-handle subdomain.
  const v = await verifyAgentSession(token, { keys, expectedAud: AUD, expectedIss: (i) => i === iss || isOwnConnectOrigin(i) });
  if (!v.ok) return json({ error: `invalid AgentSession: ${v.reason}` }, 401);
  const session = v.session;
  if (session.iss !== iss && !isOwnConnectOrigin(session.iss)) {
    return json({ error: 'invalid AgentSession: issuer not trusted' }, 401);
  }

  // Best-effort .impact name for the basic profile (on-chain reverse-resolve). `directory.agent()`
  // requires a CANONICAL eip155 id — pass a bare-address sub through and it throws, silently
  // rendering an on-chain-named home as nameless. Canonicalize first so either sub shape resolves.
  let name: string | null = null;
  try {
    const addr = addressFromSub(session.sub);
    const canonicalSub = addr ? toCanonicalAgentId(CHAIN_ID, addr) : session.sub;
    const view = await directory.agent(canonicalSub);
    name = view?.facets?.name ?? null;
  } catch {
    name = null;
  }

  const route = url.pathname.replace(/^\/me\/?/, '');
  if (route === '' || route === 'profile') {
    // spec 257 Phase 1.5 — is the SA actually deployed? A fresh Google session's `sub` is a
    // counterfactual SA; the portal gate routes to secure-home only while this is false. A nameless
    // deployed home reads `{ deployed: true, name: null }` → portal. Single read (ADR-0012); a
    // false default on RPC error is safe (the gate's secure-home call is idempotent for an
    // already-deployed SA — it short-circuits) and never traps a deployed member.
    let deployed = false;
    const addr = addressFromSub(session.sub);
    if (addr) {
      try {
        const accounts = new AgentAccountClient({
          rpcUrl: env.RPC_URL && env.RPC_URL.trim() ? env.RPC_URL : DEFAULT_RPC_URL,
          chainId: CHAIN_ID,
          entryPoint: CONTRACTS.entryPoint,
          factory: CONTRACTS.agentAccountFactory,
        });
        deployed = await accounts.isDeployed(addr);
      } catch {
        deployed = false;
      }
    }
    return json({ profile: basicProfile(session, name, deployed) });
  }
  if (route === 'sensitive') {
    const pii = sensitivePii(session);
    if (!pii) {
      return json(
        {
          error: 'step_up_required',
          reason:
            'Your contact details are protected — confirm with your device (a custody-grade sign-in) to view them. (ADR-0017 / CN-2)',
          access: session.assurance,
        },
        403,
      );
    }
    return json({ sensitive: pii });
  }
  return json({ error: 'unknown route' }, 404);
};
