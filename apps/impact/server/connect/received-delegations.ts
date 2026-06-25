// GET /connect/received-delegations  (spec 247)
//
// Person-session-authorized: the person presents their AgentSession id_token (Bearer, or
// ?id_token=). We resolve the person SA from `sub`, look up the agents they govern (the related
// vault, spec 246), and return — for each — the inbound grants those agents RECEIVED (org↔org).
// Control of the agent is established by the person↔agent link in the vault, so no per-agent
// ERC-1271 challenge is needed. No grantor person identity is exposed (ADR-0025) — org↔org only.
import { importJwks, verifyAgentSession } from '@agenticprimitives/connect';
import { getServer, json, type FnContext } from '../_lib/server-broker';
import { CONNECT_DOMAIN } from '../../src/lib/domain';

const AUD = 'impact';

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

const personFromSub = (sub?: string): string => (sub?.match(/0x[0-9a-fA-F]{40}$/)?.[0] ?? '').toLowerCase();

export const onRequestOptions = async (_: FnContext): Promise<Response> => new Response(null, { status: 204 });

export const onRequestGet = async ({ request, env }: FnContext): Promise<Response> => {
  const url = new URL(request.url);
  const iss = url.origin;
  const bearer = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const token = bearer || url.searchParams.get('id_token') || '';
  if (!token) return json({ error: 'id_token required' }, 400);

  const { jwks } = await getServer(env);
  const keys = await importJwks(jwks);
  const v = await verifyAgentSession(token, { keys, expectedAud: AUD, expectedIss: (i) => i === iss || isOwnConnectOrigin(i) });
  if (!v.ok) return json({ error: `invalid session token: ${v.reason}` }, 401);

  const person = personFromSub(v.session.sub);
  if (!person) return json({ error: 'no person address in token sub' }, 401);

  // The agents the person governs (from the related vault) → their inbound grants.
  const orgIdx = JSON.parse((await env.AUTH_CODES.get(`related-idx:${person}`)) ?? '[]') as string[];
  const received: Array<Record<string, unknown>> = [];
  for (const org of orgIdx) {
    const linkRaw = await env.AUTH_CODES.get(`related:${person}:${org}`);
    const orgName = linkRaw ? (JSON.parse(linkRaw) as { orgName?: string }).orgName ?? '' : '';
    const grants = JSON.parse((await env.AUTH_CODES.get(`delegated-idx:${org}`)) ?? '[]') as Array<Record<string, unknown>>;
    for (const g of grants) received.push({ viaOrg: org, viaOrgName: orgName, ...g });
  }
  return json({ received });
};
