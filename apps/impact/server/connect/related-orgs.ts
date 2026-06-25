// GET  /connect/related-orgs   — the person's own related-agent links (spec 246/275),
//   read from the private home vault (KV). Person-session-authorized: the person presents
//   their AgentSession id_token (Bearer, or ?id_token=). We resolve the person SA from the
//   session `sub` and return that person's links. person↔agent never travels as public graph.
//
// POST /connect/related-orgs   — register / MERGE a person→agent link the person already
//   governs (e.g. their personal treasury). Bearer session ONLY: the token's `sub` IS the
//   authority and must equal `person`. Writes the same KV the GET reads — no new data source.
//
// Ported from agenticprimitives/demo-sso-next, trimmed to impact's person-self-managed model:
// the spec-247 ERC-1271 external-custodian write path + the recoverable custody descriptor are
// dropped (impact has no external operator orgs — every managed agent hangs under the person).
import { importJwks, verifyAgentSession } from '@agenticprimitives/connect';
import { getServer, json, type FnContext } from '../_lib/server-broker';
import { CONNECT_DOMAIN } from '../../src/lib/domain';

/** Impact's personal-home audience — MUST match the aud connect.ts mints with. */
const AUD = 'impact';

/** Is `origin` one of THIS site's own Connect origins (apex + per-handle subdomains)? A Google
 *  session is minted on the central origin but consumed on the member's subdomain — same broker
 *  key + JWKS — so its `iss` is trusted here even when it isn't the exact request origin. */
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

async function verify(token: string, iss: string, env: FnContext['env']) {
  const { jwks } = await getServer(env);
  const keys = await importJwks(jwks);
  return verifyAgentSession(token, { keys, expectedAud: AUD, expectedIss: (i) => i === iss || isOwnConnectOrigin(i) });
}

export const onRequestOptions = async (_: FnContext): Promise<Response> => new Response(null, { status: 204 });

export const onRequestGet = async ({ request, env }: FnContext): Promise<Response> => {
  const url = new URL(request.url);
  const iss = url.origin;
  const bearer = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const token = bearer || url.searchParams.get('id_token') || '';
  if (!token) return json({ error: 'id_token required' }, 400);

  const v = await verify(token, iss, env);
  if (!v.ok) return json({ error: `invalid session token: ${v.reason}` }, 401);
  const person = personFromSub(v.session.sub);
  if (!person) return json({ error: 'no person address in token sub' }, 401);

  const idx = JSON.parse((await env.AUTH_CODES.get(`related-idx:${person}`)) ?? '[]') as string[];
  const orgs: Array<Record<string, unknown>> = [];
  for (const org of idx) {
    const raw = await env.AUTH_CODES.get(`related:${person}:${org}`);
    if (!raw) continue;
    const link = JSON.parse(raw) as Record<string, unknown>;
    orgs.push({
      orgAgent: link.orgAgent,
      orgName: link.orgName ?? '',
      purpose: link.purpose ?? '',
      requestedBy: link.requestedBy ?? '',
      createdAt: link.createdAt ?? null,
      // spec 246 person↔agent read delegations: membership = person→agent (the agent reads its
      // member); stewardship = agent→person (the person reads/oversees the agent).
      delegation: link.siteDelegation ?? null,
      membershipDelegation: link.membershipDelegation ?? null,
      stewardshipDelegation: link.stewardshipDelegation ?? null,
      proofHash: link.proofHash ?? null,
      // spec 275 — the agent kind + its parent in the member's tree (legacy links default to 'org').
      kind: link.kind ?? 'org',
      parent: link.parent ?? person,
    });
  }
  return json({ orgs });
};

export const onRequestPost = async ({ request, env }: FnContext): Promise<Response> => {
  const body = (await request.json().catch(() => null)) as {
    person?: string; orgAgent?: string; orgName?: string; purpose?: string; requestedBy?: string;
    siteDelegation?: unknown; stewardshipDelegation?: unknown; membershipDelegation?: unknown;
    proofHash?: string | null; kind?: string; parent?: string;
  } | null;
  const person = (body?.person ?? '').toLowerCase();
  const org = (body?.orgAgent ?? '').toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(person) || !/^0x[0-9a-f]{40}$/.test(org)) {
    return json({ error: 'person, orgAgent (0x…40) required' }, 400);
  }

  // Home-session path only: the token's `sub` IS the authority; it must equal `person`.
  const bearer = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!bearer) return json({ error: 'Bearer session required' }, 401);
  const iss = new URL(request.url).origin;
  const v = await verify(bearer, iss, env);
  if (!v.ok) return json({ error: `invalid session token: ${v.reason}` }, 401);
  const sessionPerson = personFromSub(v.session.sub);
  if (!sessionPerson || sessionPerson !== person) {
    return json({ error: 'session does not control this person' }, 401);
  }

  // MAM-D6: a non-person parent must be an agent the person already controls (in their tree).
  const parent = (body?.parent ?? person).toLowerCase();
  if (parent !== person) {
    const ownIdx = JSON.parse((await env.AUTH_CODES.get(`related-idx:${person}`)) ?? '[]') as string[];
    if (!ownIdx.includes(parent)) return json({ error: 'parent is not an agent you control' }, 401);
  }

  // MERGE with any existing record so a partial re-save (name-later) never clobbers fields it
  // doesn't carry — delegations + proofHash persist across re-saves.
  const existing = JSON.parse((await env.AUTH_CODES.get(`related:${person}:${org}`)) ?? '{}') as Record<string, unknown>;
  const pick = <T,>(next: T | undefined, prev: unknown, dflt: T): T => (next !== undefined ? next : ((prev as T) ?? dflt));
  const link = {
    ...existing,
    orgAgent: org,
    orgName: pick(body?.orgName, existing.orgName, ''),
    purpose: pick(body?.purpose, existing.purpose, ''),
    requestedBy: pick(body?.requestedBy, existing.requestedBy, ''),
    siteDelegation: pick(body?.siteDelegation, existing.siteDelegation, null),
    stewardshipDelegation: pick(body?.stewardshipDelegation, existing.stewardshipDelegation, null),
    membershipDelegation: pick(body?.membershipDelegation, existing.membershipDelegation, null),
    proofHash: pick(body?.proofHash, existing.proofHash, null),
    kind: pick(body?.kind, existing.kind, 'org'),
    parent: pick(body?.parent, existing.parent, person).toLowerCase(),
    createdAt: (existing.createdAt as number) ?? Date.now(),
  };
  await env.AUTH_CODES.put(`related:${person}:${org}`, JSON.stringify(link));
  const idx = JSON.parse((await env.AUTH_CODES.get(`related-idx:${person}`)) ?? '[]') as string[];
  if (!idx.includes(org)) {
    idx.push(org);
    await env.AUTH_CODES.put(`related-idx:${person}`, JSON.stringify(idx));
  }
  return json({ ok: true });
};
