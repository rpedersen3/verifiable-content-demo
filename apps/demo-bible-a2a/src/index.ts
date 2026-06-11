// demo-bible-a2a — the agent surface (spec 267 §6). Advertises a
// `resolve-scripture-passage` skill and orchestrates the verifiable-content flow
// against the MCP: candidate resolve → pick → entitlement → get text → verify
// commitment → enriched CitationAssertion. Browser → A2A → MCP.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { buildCitationAssertion, verifyCommitment, type Entitlement } from '@agenticprimitives/content-primitives';
import { signCredential, verifyCredentialStructural, VC_CONTEXT_V2, EIP712_SIG_2026_CONTEXT } from '@agenticprimitives/verifiable-credentials';
import { recoverAddress, keccak256, toBytes } from 'viem';
import { agentSigner, AGENT_DID, AGENT_ADDRESS } from './lib/trust.js';
import { resolveOnBehalf, pollTask, buildGrantSpec } from './a2a/client.js';
import type { Delegation } from '@agenticprimitives/delegation';
import type { Hex } from 'viem';

interface Env {
  MCP_URL?: string;
  VALIDATOR_URL?: string;
  AGENT_NAME?: string;
  ANTHROPIC_API_KEY?: string;
  ANALYZE_MODEL?: string;
  MCP?: { fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> };
  A2A_PUBLIC_ORIGIN?: string;
  BSB_AGENT_URL?: string;
  BSB_AGENT_SA?: string;
  A2A_ENF_TARGETS?: string;
  A2A_ENF_METHODS?: string;
  A2A_ENF_TIMESTAMP?: string;
}

const app = new Hono<{ Bindings: Env }>();
app.use('*', cors());

// In production the a2a reaches the mcp via a SERVICE BINDING (env.MCP) — a
// Worker cannot fetch another Worker on the same account by public URL (CF error
// 1042). Local dev / in-process smoke fall back to MCP_URL + global fetch.
const mcpUrl = (env: Env) => (env.MCP_URL ?? 'http://127.0.0.1:8790').replace(/\/$/, '');
const mcpFetch = (env: Env, path: string, init?: RequestInit) =>
  env.MCP ? env.MCP.fetch(`https://mcp${path}`, init) : fetch(`${mcpUrl(env)}${path}`, init);
const mcpGet = async (env: Env, path: string) => (await mcpFetch(env, path)).json() as Promise<any>;
async function mcpPost(env: Env, path: string, body: unknown) {
  const res = await mcpFetch(env, path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as any };
}

app.get('/health', (c) => c.json({ ok: true, service: 'demo-bible-a2a' }));

app.get('/.well-known/agent-card.json', (c) => {
  const origin = (c.env.A2A_PUBLIC_ORIGIN ?? new URL(c.req.url).origin).replace(/\/$/, '');
  return c.json({
    protocolVersion: '1.0',
    name: 'Scripture Agent',
    description: 'Verifiable Scripture + a Bible knowledge-graph vault: resolves passages by reference/translation (issuer-signed, commitment-verified), and serves entities, relationships, and verse-grounded trust/character signals as signed credentials.',
    provider: { organization: 'Agentic Primitives — Scripture Demo', url: origin },
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ['application/json'],
    defaultOutputModes: ['application/json'],
    skills: [
      {
        id: 'resolve-scripture-passage',
        name: 'Resolve scripture passage',
        description: 'Given a reference (e.g. "John 3:16") and an edition, return verified candidate descriptors, text (if entitled), and a signed citation.',
        tags: ['scripture', 'verifiable-content', 'citation'],
        examples: ['John 3:16 in bsb', 'Psalm 23:1 in bsb'],
      },
      {
        id: 'character-trust-profile',
        name: 'Character / trust profile',
        description: "Return an entity's multi-dimensional, verse-grounded trust profile (righteousness, wisdom, faithfulness, courage, truthfulness, repentance + actions) as a signed TrustProfileCredential.",
        tags: ['trust', 'character', 'verifiable-content'],
        examples: ['trust profile for David', 'signals for the Tribe of Levi'],
      },
      {
        id: 'find-entities',
        name: 'Find entities',
        description: 'Search the Bible knowledge-graph vault for people, places, events, and organizations (optionally by kind or book).',
        tags: ['knowledge-graph', 'search'],
        examples: ['find David', 'people in Romans'],
      },
      {
        id: 'entity-graph',
        name: 'Entity graph',
        description: 'Return an entity with its ontology class inheritance, relationships, and attesting verses.',
        tags: ['knowledge-graph', 'ontology', 'relationships'],
        examples: ['entity David', 'relationships of Paul'],
      },
      {
        id: 'signal-feedback',
        name: 'Submit signal feedback',
        description: "Record a connected user's challenge/agreement on a trust signal as a signed feedback assertion (ERC-8004-style) carrying the (entity, signal, verse) target + verdict + proposed correction.",
        tags: ['trust', 'feedback', 'verifiable-content', 'erc-8004'],
        examples: ['challenge God Moral 1Chr.11.14 — verse does not support the claim'],
      },
      {
        id: 'challenge-signal',
        name: 'Challenge a trust signal',
        description: 'Validate a trust signal against Scripture, scoped strictly to its cited verse + entity, returning a verse-in-context check, verdict, and recommendation.',
        tags: ['trust', 'audit', 'scripture'],
        examples: ['does 1Chr.11.14 support God being holy/just?'],
      },
    ],
  });
});

app.get('/editions', async (c) => c.json(await mcpGet(c.env, '/mcp/editions')));
app.get('/books', async (c) => c.json(await mcpGet(c.env, '/mcp/books')));

// ── Scripture-Agent vault skills (the Bible knowledge graph via the MCP vault) ──
app.post('/character-trust', async (c) => { const b = await c.req.json().catch(() => ({})); const res = await mcpPost(c.env, '/tools/get_trust_signals', b); return c.json(res.body, res.status as 200); });
app.post('/find-entities', async (c) => { const b = await c.req.json().catch(() => ({})); const res = await mcpPost(c.env, '/tools/find_entities', b); return c.json(res.body, res.status as 200); });
app.post('/entity', async (c) => { const b = await c.req.json().catch(() => ({})); const res = await mcpPost(c.env, '/tools/get_entity', b); return c.json(res.body, res.status as 200); });
app.get('/class-tree', async (c) => c.json(await mcpGet(c.env, '/mcp/class_tree')));
// Submit a signed feedback assertion (challenge/agreement) on a trust signal.
app.post('/submit-feedback', async (c) => { const b = await c.req.json().catch(() => ({})); const res = await mcpPost(c.env, '/tools/submit_feedback', b); return c.json(res.body, res.status as 200); });
// Challenge a trust signal — the agent validates it against Scripture (scoped strictly to the
// cited verse + entity) and returns a verdict + recommendation. Needs ANTHROPIC_API_KEY.
app.post('/analyze', async (c) => {
  const key = c.env.ANTHROPIC_API_KEY;
  if (!key) return c.json({ ok: false, error: 'unconfigured', analysis: 'The trust agent is not configured yet. Set the ANTHROPIC_API_KEY secret on the Scripture Agent (a2a) worker to enable live signal challenges.' });
  const b = await c.req.json().catch(() => ({})) as Record<string, string>;
  const label = String(b.subject_label ?? 'this entity').slice(0, 120);
  const kind = String(b.sig_kind ?? 'signal').slice(0, 60);
  const basis = String(b.basis ?? '').slice(0, 400);
  const osis = String(b.osis ?? '').slice(0, 40);
  const prompt = `You are a Scripture-grounded trust auditor for a Bible knowledge graph. Audit ONE trust signal, scoped STRICTLY to its cited verse and entity. The only question is: does THIS specific verse, read in its own context, support THIS specific signal for THIS specific entity?\n\nEntity: ${label}\nSignal (dimension/type): ${kind}\nSignal basis (the claim): "${basis}"\nCited verse (OSIS): ${osis || '(none)'}\n\nIn ≤200 words, markdown (short **bold** lead-ins + bullet points "- "; NO tables):\n- **Verse in context** — what ${osis || 'the cited verse'} actually says/recounts in its passage.\n- **Support check** — does that verse support this signal's claim for ${label}? Mark ✅ clearly supports / ⚠️ weak or partial / ❌ does not support, and say concretely why.\n- **Verdict** — is this signal VALID for this verse and this entity, and does its polarity/strength fit what the verse shows?\n- **Recommendation** — about THIS signal–verse–entity triple ONLY: keep as-is; tighten the wording so it matches what the verse actually says; or flag the citation as not supporting the claim so a curator can review it. Do NOT propose a different verse, and do NOT invent a different signal or claim.\nStay strictly on the cited verse — do NOT validate the claim using other passages, and do NOT recommend swapping in another verse. If the basis pins one individual's act on a whole group, note it.`;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: c.env.ANALYZE_MODEL || 'claude-sonnet-4-6', max_tokens: 700, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!r.ok) return c.json({ ok: false, error: `agent ${r.status}`, analysis: `The trust agent returned an error (${r.status}). Check the API key / model.` });
    const j = await r.json() as { content?: { text?: string }[] };
    return c.json({ ok: true, analysis: j.content?.[0]?.text ?? '(no response)' });
  } catch {
    return c.json({ ok: false, error: 'fetch failed', analysis: 'Could not reach the trust agent.' });
  }
});

// Verse text — from the canonical BSB corpus in the MCP (the single source of verse text).
app.get('/passage', async (c) => { const osis = c.req.query('osis') ?? ''; const res = await mcpPost(c.env, '/tools/get_passage', { osis }); return c.json(res.body, res.status as 200); });

// Vault read gateway — all knowledge-graph reads (entities, signals, relationships, verses,
// classes) flow through the agent → vault, so clients never call the data Worker directly.
// e.g. GET /vault/node/David  ·  GET /vault/search?q=David&kind=person
app.get('/vault/*', async (c) => {
  const sub = c.req.path.replace(/^\/vault/, '');
  const search = new URL(c.req.url).search;
  const res = await mcpPost(c.env, '/tools/graph_query', { path: `/api${sub}${search}` });
  return c.json(res.body, res.status as 200);
});

// ── Entitlements (P1): subjects come ONLY from a server-side-verified id_token, never client input ──
const CONNECT_DOMAIN = 'impact-agent.me';
const ALLOWED_AUD = ['bible-explorer', 'demo-corpus'];
function isAllowedIssuer(origin: string): boolean {
  try { const u = new URL(origin); if (u.protocol !== 'https:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') return false; if (u.pathname !== '/' && u.pathname !== '') return false; const h = u.hostname; return h === CONNECT_DOMAIN || h.endsWith(`.${CONNECT_DOMAIN}`) || h === 'localhost' || h === '127.0.0.1'; } catch { return false; }
}
function b64urlBytes(seg: string): Uint8Array { const bin = atob(seg.replace(/-/g, '+').replace(/_/g, '/')); const o = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i); return o; }
function decodeSeg<T>(seg: string): T { return JSON.parse(new TextDecoder().decode(b64urlBytes(seg))) as T; }
/** Verify an OIDC id_token against its home JWKS (ES256, iss-allowlisted *.impact-agent.me, aud, exp). */
async function verifyIdToken(idToken: string): Promise<{ sub: string; name: string }> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('id_token malformed');
  const header = decodeSeg<{ alg?: string; kid?: string }>(parts[0]!);
  const claims = decodeSeg<{ iss?: string; aud?: string; exp?: number; sub?: string; canonical_agent_id?: string; agent_name?: string }>(parts[1]!);
  const iss = String(claims.iss ?? '');
  if (!isAllowedIssuer(iss)) throw new Error('issuer not allowed');
  const base = iss.endsWith('/') ? iss.slice(0, -1) : iss;
  const jwks = (await (await fetch(`${base}/jwks`)).json()) as { keys: Array<JsonWebKey & { kid: string; alg: string }> };
  const jwk = (jwks.keys ?? []).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('no JWKS key for kid');
  if (jwk.alg !== 'ES256' || header.alg !== 'ES256') throw new Error('alg not ES256');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64urlBytes(parts[2]!) as BufferSource, new TextEncoder().encode(`${parts[0]}.${parts[1]}`) as BufferSource);
  if (!ok) throw new Error('id_token signature invalid');
  if (!ALLOWED_AUD.includes(String(claims.aud))) throw new Error('aud not allowed');
  if (typeof claims.exp !== 'number' || claims.exp * 1000 < Date.now()) throw new Error('id_token expired');
  const sub = claims.canonical_agent_id ?? claims.sub;
  if (!sub) throw new Error('no subject in id_token');
  return { sub, name: claims.agent_name ?? '' };
}

app.post('/request-entitlement', async (c) => {
  const b = await c.req.json<{ id_token?: string; edition?: string; note?: string; delegation?: unknown }>().catch(() => ({}) as Record<string, never>);
  try {
    const { sub, name } = await verifyIdToken(String(b.id_token ?? ''));
    const res = await mcpPost(c.env, '/tools/request_entitlement', { subject: sub, subjectName: name, edition: b.edition, note: b.note, readerDelegation: b.delegation });
    return c.json(res.body, res.status as 200);
  } catch (e) { return c.json({ ok: false, error: (e as Error).message }, 401); }
});
app.post('/my-entitlements', async (c) => {
  const b = await c.req.json<{ id_token?: string }>().catch(() => ({}) as { id_token?: string });
  try { const { sub } = await verifyIdToken(String(b.id_token ?? '')); const res = await mcpPost(c.env, '/tools/list_entitlements', { subject: sub }); return c.json(res.body, res.status as 200); }
  catch (e) { return c.json({ ok: false, error: (e as Error).message }, 401); }
});
app.post('/my-requests', async (c) => {
  const b = await c.req.json<{ id_token?: string }>().catch(() => ({}) as { id_token?: string });
  try { const { sub } = await verifyIdToken(String(b.id_token ?? '')); const res = await mcpPost(c.env, '/tools/list_requests', { subject: sub }); return c.json(res.body, res.status as 200); }
  catch (e) { return c.json({ ok: false, error: (e as Error).message }, 401); }
});
// Entitled read on the ASYNC A2A BUS: verify the reader, then submit a get-gated-passage TASK to the
// BSB Corpus-Manager agent presenting the reader's scoped delegation. Returns the task handle; the
// reader polls /task-status until terminal, then the verse artifact + a signed citation are available.
// Inert until the BSB agent is activated (RPC + claimed SA) and the grant is buildA2aGrantCaveats-scoped.
app.post('/resolve-on-behalf', async (c) => {
  const b = await c.req.json<{ id_token?: string; reference?: string; edition?: string; entitlement?: unknown; delegation?: Delegation }>().catch(() => ({}) as Record<string, never>);
  try {
    await verifyIdToken(String(b.id_token ?? '')); // the reader must be verified
    if (!b.reference || !b.edition || !b.delegation) return c.json({ ok: false, error: 'reference, edition, delegation required' }, 400);
    const res = await resolveOnBehalf(c.env, { reference: b.reference, edition: b.edition, entitlement: b.entitlement, delegation: b.delegation, createdAt: Date.now() });
    return c.json({ ok: true, ...res });
  } catch (e) { return c.json({ ok: false, error: (e as Error).message }, 401); }
});
app.get('/task-status', async (c) => {
  const taskId = c.req.query('taskId');
  if (!taskId) return c.json({ ok: false, error: 'taskId required' }, 400);
  try { return c.json({ ok: true, task: await pollTask(c.env, taskId as Hex) }); }
  catch (e) { return c.json({ ok: false, error: (e as Error).message }, 502); }
});
// The scoped-grant SPEC a reader's home must mint to authorize an async entitled read on the bus:
// delegate = this Scripture Agent, allowedTargets = BSB SA, allowedMethods = skill, + timestamp.
app.get('/a2a-grant-spec', (c) => {
  const skill = c.req.query('skill') ?? 'get-gated-passage';
  return c.json({ ok: true, ...buildGrantSpec(c.env, skill, Math.floor(Date.now() / 1000)) });
});

// Entitled read (sync): verify the reader, then fetch gated text presenting their entitlement (presenter-bound at the MCP).
app.post('/resolve-licensed', async (c) => {
  const b = await c.req.json<{ id_token?: string; reference?: string; edition?: string; entitlement?: unknown }>().catch(() => ({}) as Record<string, never>);
  try {
    const { sub } = await verifyIdToken(String(b.id_token ?? ''));
    const res = await mcpPost(c.env, '/tools/get_passage_text', { reference: b.reference, edition: b.edition, subject: sub, entitlement: b.entitlement });
    return c.json(res.body, res.status as 200);
  } catch (e) { return c.json({ ok: false, error: (e as Error).message }, 401); }
});

// Issue a signed Entitlement for a gated edition (proxied to the corpus issuer).
app.post('/issue-entitlement', async (c) => {
  const body = await c.req.json<{ edition?: string }>().catch(() => ({}) as { edition?: string });
  const res = await mcpPost(c.env, '/tools/issue_entitlement', { edition: body.edition });
  return c.json(res.body, res.status as 200);
});

type ResolveBody = { reference?: string; edition?: string; entitlement?: Entitlement; agentRunId?: string; outputId?: string };

/** Resolve → pick → text (gated) → verify → sign citation. Shared by /resolve + /ask. */
async function doResolve(env: Env, body: ResolveBody): Promise<{ status: number; payload: any }> {
  if (!body.reference) return { status: 400, payload: { ok: false, error: 'reference required' } };

  const resolved = await mcpPost(env, '/tools/resolve', { reference: body.reference });
  if (!resolved.body?.ok) return { status: resolved.status, payload: resolved.body };
  const { canonicalReference, display, candidates } = resolved.body;

  const pick =
    (body.edition && candidates.find((x: any) => x.edition === body.edition)) ||
    candidates.find((x: any) => x.admitted && x.verification?.ok) ||
    candidates[0];
  if (!pick) return { status: 200, payload: { ok: true, canonicalReference, display, candidates, accessible: false, text: null, error: 'no candidate' } };

  const edition = pick.edition;
  const textRes = await mcpPost(env, '/tools/get_passage_text', { reference: body.reference, edition, entitlement: body.entitlement });
  const accessible = textRes.status === 200 && textRes.body?.ok;
  let text: string | null = null;
  let commitmentVerified = false;
  if (accessible) {
    text = textRes.body.text as string;
    commitmentVerified = pick.commitment ? verifyCommitment(text, pick.commitment) : false;
  }

  const unsignedCitation = buildCitationAssertion({
    issuer: AGENT_DID,
    subjectId: 'urn:scripture:reader',
    canonicalId: canonicalReference.id,
    descriptorId: pick.descriptorId,
    contentType: pick.selector?.kind === 'scripture' ? 'scripture.verse' : 'content',
    citationKind: accessible ? 'quote' : 'reference',
    commitment: pick.commitment,
    commitmentVerified,
    contentIssuer: pick.issuer.address,
    validFrom: new Date().toISOString(),
    agentRunId: body.agentRunId,
    outputId: body.outputId,
    normalizationSpec: pick.commitment?.normalization,
  });
  // signCredential appends the EIP-712 context; pre-set both so the signed
  // citation's proof.credentialHash matches its body (verifiable downstream).
  const citation = await signCredential({ ...unsignedCitation, '@context': [VC_CONTEXT_V2, EIP712_SIG_2026_CONTEXT] }, agentSigner);

  return {
    status: 200,
    payload: {
      ok: true,
      canonicalReference,
      display,
      edition,
      candidates,
      chosen: { descriptorId: pick.descriptorId, edition, issuerName: pick.issuerName, verification: pick.verification, accessPolicy: pick.accessPolicy, selector: pick.selector, commitment: pick.commitment },
      accessible,
      accessPolicy: pick.accessPolicy,
      text,
      commitmentVerified,
      citation,
      ...(accessible ? {} : { gate: textRes.body?.detail ?? textRes.body?.error }),
    },
  };
}

// Verify a RANGE of verses (e.g. "John 3:1-16" or a whole chapter "John 3").
app.post('/resolve-range', async (c) => {
  const body = await c.req.json<{ reference?: string; edition?: string }>().catch(() => ({}) as { reference?: string; edition?: string });
  const res = await mcpPost(c.env, '/tools/resolve_range', { reference: body.reference, edition: body.edition ?? 'bsb' });
  return c.json(res.body, res.status as 200);
});

// The orchestrated skill (single passage): resolve → pick → text → verify → cite.
app.post('/resolve', async (c) => {
  const body = await c.req.json<ResolveBody>().catch(() => ({}) as ResolveBody);
  const r = await doResolve(c.env, body);
  return c.json(r.payload, r.status as 200);
});

// ── AI-safe citation flow ──────────────────────────────────────────────────
// A tiny topic index stands in for an LLM's passage selection; the VALUE is the
// verifiable, signed citations the agent emits (an LLM would replace this map).
const TOPICS: { match: RegExp; topic: string; passages: { reference: string; edition: string }[] }[] = [
  { match: /love|world|eternal|saved|gave/i, topic: "God's love", passages: [{ reference: 'John 3:16', edition: 'bsb' }, { reference: 'Romans 8:28', edition: 'bsb' }] },
  { match: /comfort|shepherd|fear|valley|afraid|alone/i, topic: 'comfort in hardship', passages: [{ reference: 'Psalms 23:1', edition: 'bsb' }, { reference: 'Psalms 23:4', edition: 'bsb' }] },
  { match: /strength|strong|endure|can do|overcome/i, topic: 'strength', passages: [{ reference: 'Philippians 4:13', edition: 'bsb' }] },
  { match: /begin|creation|created|origin/i, topic: 'creation', passages: [{ reference: 'Genesis 1:1', edition: 'bsb' }, { reference: 'John 1:1', edition: 'bsb' }] },
];

// In-memory transparency log (durable D1 in production). Append-only.
const transparencyLog: { runId: string; question: string; reference: string; edition: string; descriptorId: string; commitment?: string; citationKind: string }[] = [];

app.post('/ask', async (c) => {
  const body = await c.req.json<{ question?: string }>().catch(() => ({}) as { question?: string });
  const question = (body.question ?? '').trim();
  if (!question) return c.json({ ok: false, error: 'question required' }, 400);

  const hit = TOPICS.find((t) => t.match.test(question));
  const runId = `run_${question.length}_${question.replace(/\W+/g, '').slice(0, 8)}`;
  if (!hit) {
    return c.json({ ok: true, question, topic: null, answer: "I don't have sourced passages for that question yet.", citations: [] });
  }

  const cited = [];
  const lines: string[] = [];
  for (const p of hit.passages) {
    const r = await doResolve(c.env, { reference: p.reference, edition: p.edition, agentRunId: runId, outputId: `ask:${hit.topic}` });
    const pl = r.payload;
    if (!pl?.ok || !pl.citation) continue;
    if (pl.accessible && pl.text) lines.push(`“${pl.text}” — ${pl.display?.reference ?? p.reference}`);
    const rec = {
      reference: pl.display?.reference ?? p.reference,
      edition: p.edition,
      text: pl.accessible ? pl.text : null,
      canonicalId: pl.canonicalReference?.id,
      descriptorId: pl.chosen?.descriptorId,
      commitment: pl.chosen?.commitment,
      citation: pl.citation,
    };
    cited.push(rec);
    transparencyLog.push({ runId, question, reference: rec.reference, edition: p.edition, descriptorId: rec.descriptorId, commitment: rec.commitment?.value, citationKind: pl.citation.credentialSubject?.citationKind });
  }

  const answer = lines.length ? `On ${hit.topic}, the sources say:\n\n${lines.join('\n\n')}` : `I found sources on ${hit.topic} but the text is gated.`;
  return c.json({ ok: true, question, topic: hit.topic, runId, answer, citations: cited });
});

// Independently verify a CitationAssertion: (a) the agent's signature on the
// citation, (b) the cited commitment still matches the live issuer descriptor.
app.post('/verify', async (c) => {
  const body = await c.req.json<{ citation?: any; reference?: string; edition?: string }>().catch(() => ({}) as any);
  if (!body.citation || !body.reference || !body.edition) return c.json({ ok: false, error: 'citation + reference + edition required' }, 400);

  // (a) agent signature over the citation (structural + EIP-712 recovery).
  const vr = verifyCredentialStructural(body.citation);
  let agentSignatureValid = false;
  let signer: string | null = null;
  if (vr.structural && vr.expectedDigest && vr.proofValue) {
    try {
      signer = await recoverAddress({ hash: vr.expectedDigest, signature: vr.proofValue });
      agentSignatureValid = signer.toLowerCase() === AGENT_ADDRESS.toLowerCase();
    } catch {
      agentSignatureValid = false;
    }
  }

  // (b) the cited commitment matches the live issuer descriptor (re-resolve).
  const commitmentValue = body.citation.credentialSubject?.commitment?.value as string | undefined;
  const vc = await mcpPost(c.env, '/tools/verify_citation', { reference: body.reference, edition: body.edition, commitment: commitmentValue });
  const commitmentMatchesSource = !!vc.body?.matches;

  return c.json({
    ok: agentSignatureValid && commitmentMatchesSource,
    agentSignatureValid,
    signer,
    expectedAgent: AGENT_ADDRESS,
    commitmentMatchesSource,
    structuralIssues: vr.issues,
  });
});

// The transparency log — every citation the agent has emitted this run.
app.get('/transparency', (c) => c.json({ ok: true, count: transparencyLog.length, entries: transparencyLog.slice(-50) }));

// Trust-graph facade: resolve + cite, ASSEMBLE the evidence bundle, hand it to
// the independent (hosted) validator, and return its outcome + signed
// ValidationAttestation + trust graph. (The zk membership proof needs a Node
// prover, so it's added by the local `pnpm validate:e2e`, not this Worker.)
app.post('/trust/validate', async (c) => {
  // Optional `text` overrides the served text — used by the tamper demo: edit a
  // verse and the validator's commitment check catches it (text ≠ committed hash).
  const body = await c.req.json<{ reference?: string; edition?: string; text?: string }>().catch(() => ({}) as { reference?: string; edition?: string; text?: string });
  if (!body.reference) return c.json({ ok: false, error: 'reference required' }, 400);
  const vurl = (c.env.VALIDATOR_URL ?? '').replace(/\/$/, '');
  if (!vurl) return c.json({ ok: false, error: 'validator not configured (set VALIDATOR_URL)' }, 503);

  const runId = `run_${body.reference.replace(/\W+/g, '')}_${Date.now()}`;
  const outputId = 'answer_1';
  const r = await doResolve(c.env, { reference: body.reference, edition: body.edition, agentRunId: runId, outputId });
  const pl = r.payload;
  if (!pl?.ok) return c.json(pl, r.status as 400);
  const cand = pl.candidates.find((x: any) => x.edition === (body.edition ?? pl.edition)) ?? pl.candidates[0];
  if (!cand) return c.json({ ok: false, error: 'no candidate' }, 404);

  // The descriptor + commitment stay the issuer's original; only the served text
  // may be the (edited) override → an edit fails commitmentMatchesText.
  const text: string | null = body.text != null ? body.text : pl.text ?? null;
  const edited = body.text != null && body.text !== (pl.text ?? null);
  const responseHash = keccak256(toBytes(text ?? ''));
  const bundle = {
    intent: { intentType: 'quote', requestedReference: pl.display?.reference ?? body.reference, requestedEdition: cand.edition, agentRunId: runId, outputId },
    agent: { agentId: AGENT_DID, agentName: c.env.AGENT_NAME ?? 'scripture-resolver.impact' },
    content: {
      canonicalId: pl.canonicalReference.id,
      canonicalEnvelope: pl.canonicalReference.envelope,
      scheme: cand.descriptor.contentType,
      displayReference: pl.display?.reference,
      descriptorId: cand.descriptorId,
      descriptor: cand.descriptor,
      issuer: cand.issuer.address,
      issuerName: cand.issuerName,
      edition: cand.edition,
      accessPolicy: cand.accessPolicy,
      rightsStatus: cand.rightsStatus,
    },
    proof: { commitment: cand.commitment, commitmentVerified: text != null, corpusRef: cand.corpusRef, corpusRoot: cand.corpusRoot, inclusionProof: cand.inclusionProof, leafIndex: cand.leafIndex },
    policy: { policyProfile: 'public-domain-demo', policyDecision: text != null ? 'allow' : 'gated', entitlement: null },
    citation: pl.citation,
    response: { text, responseHash, quotedSpans: text ? [{ start: 0, end: text.length, descriptorId: cand.descriptorId }] : [] },
  };

  const vres = await fetch(`${vurl}/validate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(bundle) });
  const validation = (await vres.json()) as any;
  return c.json({
    ok: true,
    reference: pl.display?.reference ?? body.reference,
    edition: cand.edition,
    accessible: pl.accessible,
    text,
    edited,
    originalText: pl.text,
    outcome: validation.outcome,
    checks: validation.checks,
    attestation: validation.attestation,
    graph: validation.graph,
    anchor: validation.anchor,
    validator: vurl,
    // App URL per role, so the UI can label which deployed service each node is.
    services: {
      agent: (c.env.A2A_PUBLIC_ORIGIN ?? new URL(c.req.url).origin).replace(/\/$/, ''),
      mcp: mcpUrl(c.env),
      validator: vurl,
    },
  });
});

export default app;
