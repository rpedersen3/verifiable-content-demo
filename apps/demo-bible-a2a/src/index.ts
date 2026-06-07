// demo-bible-a2a — the agent surface (spec 267 §6). Advertises a
// `resolve-scripture-passage` skill and orchestrates the verifiable-content flow
// against the MCP: candidate resolve → pick → entitlement → get text → verify
// commitment → enriched CitationAssertion. Browser → A2A → MCP.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { buildCitationAssertion, verifyCommitment, type Entitlement } from '@agenticprimitives/content-primitives';

interface Env {
  MCP_URL?: string;
  A2A_PUBLIC_ORIGIN?: string;
}

const app = new Hono<{ Bindings: Env }>();
app.use('*', cors());

const mcpUrl = (env: Env) => (env.MCP_URL ?? 'http://127.0.0.1:8790').replace(/\/$/, '');
const mcpGet = async (env: Env, path: string) => (await fetch(`${mcpUrl(env)}${path}`)).json() as Promise<any>;
async function mcpPost(env: Env, path: string, body: unknown) {
  const res = await fetch(`${mcpUrl(env)}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
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

// The orchestrated skill: candidate resolve → pick → text (gated) → verify → cite.
app.post('/resolve', async (c) => {
  type ResolveBody = { reference?: string; edition?: string; entitlement?: Entitlement; agentRunId?: string; outputId?: string };
  const body = await c.req.json<ResolveBody>().catch(() => ({}) as ResolveBody);
  if (!body.reference) return c.json({ ok: false, error: 'reference required' }, 400);

  // 1. candidate resolution (across editions/issuers).
  const resolved = await mcpPost(c.env, '/tools/resolve', { reference: body.reference });
  if (!resolved.body?.ok) return c.json(resolved.body, resolved.status as 400);
  const { canonicalReference, display, candidates } = resolved.body;

  // 2. pick a candidate: prefer the requested edition; else the first admitted+verified.
  const pick =
    (body.edition && candidates.find((x: any) => x.edition === body.edition)) ||
    candidates.find((x: any) => x.admitted && x.verification?.ok) ||
    candidates[0];
  if (!pick) return c.json({ ok: true, canonicalReference, display, candidates, accessible: false, text: null, error: 'no candidate' });

  const edition = pick.edition;

  // 3. attempt text retrieval (gated by access policy + entitlement).
  const textRes = await mcpPost(c.env, '/tools/get_passage_text', { reference: body.reference, edition, entitlement: body.entitlement });
  const accessible = textRes.status === 200 && textRes.body?.ok;
  let text: string | null = null;
  let commitmentVerified = false;
  if (accessible) {
    text = textRes.body.text as string;
    // 4. independently re-verify the rendering against the published commitment.
    commitmentVerified = pick.commitment ? verifyCommitment(text, pick.commitment) : false;
  }

  // 5. build a signed-shape (unsigned here) enriched citation — the AI-safe record.
  const citation = buildCitationAssertion({
    issuer: 'did:web:scripture-resolver.agent',
    subjectId: 'urn:scripture:reader',
    canonicalId: canonicalReference.id,
    descriptorId: pick.descriptorId,
    contentType: 'scripture.verse',
    citationKind: accessible ? 'quote' : 'reference',
    commitment: pick.commitment,
    commitmentVerified,
    contentIssuer: pick.issuer.address,
    validFrom: new Date().toISOString(),
    agentRunId: body.agentRunId,
    outputId: body.outputId,
    normalizationSpec: pick.commitment?.normalization,
  });

  return c.json({
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
  });
});

export default app;
