// POST /oidc/grant — redeem a server-minted enrollment grant for an OIDC authorization code
// (spec 230 §4.2; SEC-001 + SEC-002). The home SPA first POSTs /oidc/authorize-grant for a
// `grant_id` bound to the validated client registry + the registered delegate, runs the
// credential ceremony to sign a site-login delegation whose `delegate` equals that registered
// delegate, then POSTs HERE with { grant_id, delegation }. We:
//   1. enforce same-origin (Origin === iss),
//   2. look up + DELETE the bound grant (single-use),
//   3. reject unless the supplied delegation's `delegate` equals the registered delegate,
//   4. verify the delegation (ERC-1271 against the delegator + timestamp window),
//   5. mint the id_token + a single-use authorization code bound to the grant's PKCE challenge +
//      client_id + redirect_uri, and record `oidc-deleg:<digest> → client_id` (SEC-002).
//
// The OIDC code (not the token) travels back in the redirect; /token does the PKCE exchange.

import { mintIdToken, newAuthCode } from '@agenticprimitives/connect';
import { toCanonicalAgentId } from '@agenticprimitives/identity-directory-adapters';
import { getServer, json, resolveOrigin, type FnContext } from '../_lib/server-broker';
import { verifyDelegation, type IncomingDelegation } from '../_lib/verify-delegation';
import { CHAIN_ID } from '../../src/lib/chain';
import type { StoredEnrollmentGrant } from './authorize-grant';

const ID_TOKEN_TTL = 3600; // the relying app treats the id_token as the session
const CODE_TTL_MS = 300_000; // 5 min PKCE exchange window
const DELEG_BIND_TTL_SEC = 3600; // matches id_token TTL

interface GrantBody {
  grant_id?: string;
  delegation?: IncomingDelegation;
  /** x402 (spec 272): the payer-treasury → OPEN/payee payment delegation the reader authorized. Its
   *  delegate is OPEN/the payee (NOT the client's site delegate), so it is ERC-1271-verified but NOT
   *  delegate-matched. Carried to the relying app, which stores it in the payee vault + redeems per read. */
  paymentDelegation?: IncomingDelegation;
  /** x402 subscription: the standing treasury → payee PULL mandate (delegate = payee). */
  pullDelegation?: IncomingDelegation;
  /** The settlement tx hash of the first charge done IN the ceremony. Opaque; carried to the app. */
  settlementHash?: string;
  /** The payer treasury SA (carried so the app can show/verify it). */
  treasury?: string;
}

export const onRequestPost = async ({ request, env }: FnContext): Promise<Response> => {
  // SEC-001: /oidc/grant is reachable ONLY from the home SPA.
  const iss = resolveOrigin(request, env);
  const reqOrigin = request.headers.get('origin');
  if (!reqOrigin || reqOrigin !== iss) {
    return json({ error: 'grant must be called from the home origin' }, 403);
  }

  const body = (await request.json().catch(() => null)) as GrantBody | null;
  if (!body?.grant_id || !body.delegation) {
    return json({ error: 'grant_id + delegation required' }, 400);
  }

  // Single-use: delete-after-read.
  const grantKey = `oidc-grant:${body.grant_id}`;
  const raw = await env.AUTH_CODES.get(grantKey);
  await env.AUTH_CODES.delete(grantKey);
  if (!raw) return json({ error: 'invalid or already-used grant_id' }, 400);
  const grant = JSON.parse(raw) as StoredEnrollmentGrant;

  // SEC-001: the delegation's `delegate` MUST equal the delegate recorded at authorize-grant
  // (from the registry, not the request). Closes the "attacker chooses delegate" attack.
  if (body.delegation.delegate.toLowerCase() !== grant.delegate.toLowerCase()) {
    return json({ error: 'delegation delegate does not match the registered client delegate' }, 401);
  }

  // ERC-1271 + timestamp-window verification. Returns the canonical EIP-712 digest on success.
  const v = await verifyDelegation(env, body.delegation);
  if (!v.ok) return json({ error: `delegation proof failed: ${v.reason}` }, 401);

  // x402 (spec 272): if a payment / pull delegation rode along, verify each independently against ITS
  // delegator (the treasury SA) — ERC-1271 + window. NOT delegate-matched to the client (its delegate
  // is OPEN / the payee). Reject an invalid one rather than silently dropping it.
  if (body.paymentDelegation) {
    const pv = await verifyDelegation(env, body.paymentDelegation);
    if (!pv.ok) return json({ error: `payment delegation proof failed: ${pv.reason}` }, 401);
  }
  if (body.pullDelegation) {
    const pv = await verifyDelegation(env, body.pullDelegation);
    if (!pv.ok) return json({ error: `pull delegation proof failed: ${pv.reason}` }, 401);
  }

  // Mint the id_token bound to the grant's client + nonce + agent_name.
  const sub = toCanonicalAgentId(CHAIN_ID, body.delegation.delegator);
  const { signer } = await getServer(env);
  const idToken = await mintIdToken(
    {
      iss,
      sub,
      aud: grant.client_id,
      nonce: grant.nonce || undefined,
      agentName: grant.agent_name,
      ttlSeconds: ID_TOKEN_TTL,
    },
    signer,
  );

  // SEC-002: bind the canonical delegation digest to its originating client so a leaked
  // delegation can't be replayed to mint id_tokens for a DIFFERENT relying app.
  await env.AUTH_CODES.put(
    `oidc-deleg:${v.digest.toLowerCase()}`,
    JSON.stringify({ client_id: grant.client_id, agent_name: grant.agent_name }),
    { expirationTtl: DELEG_BIND_TTL_SEC },
  );

  // Stash the grant under a single-use code, BOUND to the PKCE challenge + client + redirect.
  const code = newAuthCode();
  await env.AUTH_CODES.put(
    `oidc:${code}`,
    JSON.stringify({
      id_token: idToken,
      delegation: body.delegation,
      paymentDelegation: body.paymentDelegation ?? null,
      pullDelegation: body.pullDelegation ?? null,
      settlementHash: body.settlementHash ?? null,
      treasury: body.treasury ?? null,
      code_challenge: grant.code_challenge,
      client_id: grant.client_id,
      redirect_uri: grant.redirect_uri,
    }),
    { expirationTtl: Math.ceil(CODE_TTL_MS / 1000) },
  );
  return json({ code });
};
