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

interface Env {
  MCP_URL?: string;
  VALIDATOR_URL?: string;
  AGENT_NAME?: string;
  MCP?: { fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> };
  A2A_PUBLIC_ORIGIN?: string;
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
    name: 'Scripture Resolver',
    description: 'Resolves scripture passages by reference + translation via verifiable content descriptors (issuer-signed, commitment-verified). Public-domain editions only by default.',
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
    ],
  });
});

app.get('/editions', async (c) => c.json(await mcpGet(c.env, '/mcp/editions')));
app.get('/books', async (c) => c.json(await mcpGet(c.env, '/mcp/books')));

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
  const body = await c.req.json<{ reference?: string; edition?: string }>().catch(() => ({}) as { reference?: string; edition?: string });
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

  const text: string | null = pl.text ?? null;
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
