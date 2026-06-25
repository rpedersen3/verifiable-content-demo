// POST /token — single-use code exchange (CN-9; the token never appears in a URL).
//
// Impact (personal home) uses only the legacy code-exchange: the OIDC callback stashes
// the minted AgentSession under a single-use `code:<id>` and redirects back with `?code`;
// the client exchanges { code, aud } here for { agentSession }. (The relying-app
// authorization_code + delegation grants from impact are omitted — impact is a
// home, not an SSO broker for other apps.)
import { jsonCors, preflight, type FnContext } from "./_lib/server-broker";

export const onRequestOptions = ({ request }: FnContext): Response => preflight(request);

export const onRequestPost = async ({ request, env }: FnContext): Promise<Response> => {
  const body = (await request.json().catch(() => ({}))) as { code?: string; aud?: string };
  if (!body.code || !body.aud) return jsonCors({ error: "code + aud are required" }, request, 400);

  const key = `code:${body.code}`;
  const raw = await env.AUTH_CODES.get(key);
  await env.AUTH_CODES.delete(key); // single-use
  if (!raw) return jsonCors({ error: "invalid or already-used code" }, request, 400);

  const { token, aud } = JSON.parse(raw) as { token: string; aud: string };
  if (aud !== body.aud) return jsonCors({ error: "aud mismatch" }, request, 400);
  return jsonCors({ agentSession: token }, request);
};
