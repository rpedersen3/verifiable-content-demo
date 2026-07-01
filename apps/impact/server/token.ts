// POST /token — single-use code exchange (CN-9; the token never appears in a URL).
//
// Two grants:
//  • OIDC authorization_code (spec 230): a relying app exchanges { grant_type:'authorization_code',
//    code, code_verifier, client_id, redirect_uri } (minted at /oidc/grant) for { id_token, delegation }.
//    PKCE S256 is verified here; the code is single-use and bound to the client + redirect at grant time.
//  • Legacy self-login: impact's own OIDC/passkey callback stashes a minted AgentSession under
//    `code:<id>` and redirects back with `?code`; the client exchanges { code, aud } for { agentSession }.
import { verifyPkceS256 } from "@agenticprimitives/connect";
import { jsonCors, preflight, type FnContext } from "./_lib/server-broker";

const ID_TOKEN_TTL = 3600;

interface TokenBody {
  grant_type?: string;
  code?: string;
  code_verifier?: string;
  client_id?: string;
  redirect_uri?: string;
  aud?: string;
}

export const onRequestOptions = ({ request }: FnContext): Response => preflight(request);

export const onRequestPost = async ({ request, env }: FnContext): Promise<Response> => {
  const body = (await request.json().catch(() => ({}))) as TokenBody;

  // ── OIDC authorization_code grant (spec 230) ──
  if (body.grant_type === "authorization_code" || body.code_verifier) {
    if (!body.code || !body.code_verifier || !body.client_id || !body.redirect_uri) {
      return jsonCors({ error: "code, code_verifier, client_id, redirect_uri required" }, request, 400);
    }
    const key = `oidc:${body.code}`;
    const raw = await env.AUTH_CODES.get(key);
    await env.AUTH_CODES.delete(key); // single-use, regardless of outcome
    if (!raw) return jsonCors({ error: "invalid or already-used code" }, request, 400);
    const grant = JSON.parse(raw) as {
      id_token: string;
      delegation: unknown;
      code_challenge: string;
      client_id: string;
      redirect_uri: string;
    };
    if (grant.client_id !== body.client_id) return jsonCors({ error: "client_id mismatch" }, request, 400);
    if (grant.redirect_uri !== body.redirect_uri) return jsonCors({ error: "redirect_uri mismatch" }, request, 400);
    if (!(await verifyPkceS256(body.code_verifier, grant.code_challenge))) {
      return jsonCors({ error: "PKCE verification failed" }, request, 400);
    }
    return jsonCors(
      { id_token: grant.id_token, token_type: "Bearer", expires_in: ID_TOKEN_TTL, delegation: grant.delegation ?? undefined },
      request,
    );
  }

  // ── Legacy self-login code-exchange ──
  if (!body.code || !body.aud) return jsonCors({ error: "code + aud are required" }, request, 400);
  const key = `code:${body.code}`;
  const raw = await env.AUTH_CODES.get(key);
  await env.AUTH_CODES.delete(key); // single-use
  if (!raw) return jsonCors({ error: "invalid or already-used code" }, request, 400);

  const { token, aud } = JSON.parse(raw) as { token: string; aud: string };
  if (aud !== body.aud) return jsonCors({ error: "aud mismatch" }, request, 400);
  return jsonCors({ agentSession: token }, request);
};
