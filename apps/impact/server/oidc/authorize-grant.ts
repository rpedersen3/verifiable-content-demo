// POST /oidc/authorize-grant — server-minted enrollment-grant record (spec 230 §4.2, SEC-001).
//
// The relying app redirects the user to `<home>/?client_id=&redirect_uri=&state=&nonce=
// &code_challenge=&agent_name=&delegation_template=...`. The home SPA parses those params and
// POSTs them HERE first, BEFORE running the credential ceremony. We:
//   1. validate the params against the OIDC client registry (client_id exists, redirect_uri
//      exact-matches, delegation_template is allowed, code_challenge_method is S256),
//   2. mint a fresh server-side `grant_id`, stash the bound record with a 10-minute TTL
//      (`oidc-grant:<id>` → { client_id, redirect_uri, agent_name, delegate (from REGISTRY —
//      anti-spoof), code_challenge, nonce, template, exp_ms }),
//   3. return { grant_id, delegate } so the SPA knows the canonical delegate to bind the
//      delegation to.
//
// /oidc/grant then accepts ONLY { grant_id, delegation } and verifies the delegation against
// the bound record + the registered delegate. A leaked delegation cannot be replayed — there is
// no bound grant_id, and any fresh authorize-grant still binds to the REGISTERED delegate.

import { getServer, json, resolveOrigin, type FnContext } from '../_lib/server-broker';
import { getClient, clientAllowsRedirect, clientAllowsTemplate, getClientDelegate, isAllowedRelyingOrigin } from '../../src/lib/oidc-clients';

const GRANT_TTL_SEC = 600; // 10 min — covers ceremony + one retry

interface AuthorizeGrantBody {
  client_id?: string;
  redirect_uri?: string;
  agent_name?: string;
  delegation_template?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  nonce?: string;
}

export const onRequestPost = async ({ request, env }: FnContext): Promise<Response> => {
  // SEC-001 (origin check): only the home SPA can mint enrollment grants.
  const iss = resolveOrigin(request, env);
  const reqOrigin = request.headers.get('origin');
  if (!reqOrigin || reqOrigin !== iss) {
    return json({ error: 'authorize-grant must be called from the home origin' }, 403);
  }

  const body = (await request.json().catch(() => null)) as AuthorizeGrantBody | null;
  // agent_name is OPTIONAL (name-deferred connect); every other field stays REQUIRED.
  if (!body?.client_id || !body.redirect_uri || !body.code_challenge || !body.delegation_template) {
    return json({ error: 'client_id + redirect_uri + code_challenge + delegation_template required' }, 400);
  }
  if (body.code_challenge_method && body.code_challenge_method !== 'S256') {
    return json({ error: 'code_challenge_method must be S256' }, 400);
  }

  // Client registry — exact redirect + allowed template (CN-1, spec 230 §6).
  const client = getClient(body.client_id);
  if (!client) return json({ error: `unknown client_id "${body.client_id}"` }, 400);
  if (!clientAllowsRedirect(client, body.redirect_uri)) {
    return json({ error: 'redirect_uri not allowed for client' }, 400);
  }
  if (!clientAllowsTemplate(client, body.delegation_template)) {
    return json({ error: `delegation_template "${body.delegation_template}" not allowed` }, 400);
  }
  // SEC-005 defense-in-depth: the redirect_uri's origin must ALSO be in the global allowlist.
  if (!isAllowedRelyingOrigin(body.redirect_uri)) {
    return json({ error: 'redirect_uri origin not in allowlist' }, 400);
  }

  const { signer } = await getServer(env); // require BROKER_PRIVATE_JWK upfront
  void signer;
  const grant_id = generateGrantId();
  const exp_ms = Date.now() + GRANT_TTL_SEC * 1000;
  await env.AUTH_CODES.put(
    `oidc-grant:${grant_id}`,
    JSON.stringify({
      client_id: body.client_id,
      redirect_uri: body.redirect_uri,
      agent_name: body.agent_name ?? '',
      // SEC-001 anti-spoof: the delegate comes FROM THE REGISTRY, not the request.
      delegate: getClientDelegate(client),
      code_challenge: body.code_challenge,
      nonce: body.nonce ?? '',
      delegation_template: body.delegation_template,
      exp_ms,
    }),
    { expirationTtl: GRANT_TTL_SEC },
  );
  return json({ grant_id, delegate: getClientDelegate(client), expires_in: GRANT_TTL_SEC });
};

function generateGrantId(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Shape of a stored enrollment grant — exported so /oidc/grant can read it. */
export interface StoredEnrollmentGrant {
  client_id: string;
  redirect_uri: string;
  agent_name: string;
  delegate: `0x${string}`;
  code_challenge: string;
  nonce: string;
  delegation_template: string;
  exp_ms: number;
}
