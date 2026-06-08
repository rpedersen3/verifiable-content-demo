// demo-bible-mcp — MCP server that resolves scripture passages via the
// verifiable-content naming/descriptor approach (spec 266/267). Hono + Cloudflare
// Workers. Candidate resolution (not one "official" answer) + tool-policy
// classification + corpus-access/entitlement gating + @agenticprimitives/audit.
//
// ADR-0033: no rendering text on-chain / in any published commitment; only the
// public-domain BSB text is shipped, served from the app's off-platform store.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { declareTool, evaluatePolicy, type ToolClassification } from '@agenticprimitives/tool-policy';
import {
  verifyContentDescriptor,
  evaluateEntitlement,
  resolveCandidates,
  verifyCommitment,
  type Entitlement,
  type ContentDescriptor,
  type TrustProfileConfig,
  type ResolutionConstraints,
} from '@agenticprimitives/content-primitives';
import { parseScriptureAlias, BOOKS, SCRIPTURE_VERSE_CONTENT_TYPE } from '@agenticprimitives/scripture-content-extension';
import { buildEvent, createConsoleAuditSink, composeSinks, type AuditSink } from '@agenticprimitives/audit';
import { signCredential, VC_CONTEXT_V2, EIP712_SIG_2026_CONTEXT, type UnsignedCredential } from '@agenticprimitives/verifiable-credentials';

// signCredential() appends EIP712_SIG_2026_CONTEXT to @context, so the unsigned
// body MUST already carry both contexts or proof.credentialHash won't match the
// returned body. Pre-set the canonical pair.
const VC_CONTEXTS = [VC_CONTEXT_V2, EIP712_SIG_2026_CONTEXT];
import { getCorpora, inclusionProof, EDITIONS, type BuiltCorpus } from './editions/registry.js';
import { verifySignedEntitlement } from './lib/trust.js';
import { resolveTrust, type McpEnv, type TrustContext } from './lib/trust-context.js';

type Env = McpEnv;

const app = new Hono<{ Bindings: Env }>();
app.use('*', cors());

const RESOLVE_CLS: ToolClassification = { '@sa-tool': 'service-only', '@sa-auth': 'service-hmac', '@sa-risk-tier': 'low' };
const TEXT_CLS: ToolClassification = { '@sa-tool': 'service-only', '@sa-auth': 'service-hmac', '@sa-risk-tier': 'low', '@sa-validation': 'json-schema' };
const VERIFY_CLS: ToolClassification = { '@sa-tool': 'service-only', '@sa-auth': 'service-hmac', '@sa-risk-tier': 'low' };
declareTool({ name: 'resolve' }, RESOLVE_CLS);
declareTool({ name: 'get_passage_text' }, TEXT_CLS);
declareTool({ name: 'verify_citation' }, VERIFY_CLS);

// Phase-1 trust profile derived from the resolved trust context (the trusted
// issuer is the dev EOA or the on-chain issuer SA). A descriptor is a POLICY
// INPUT, not a grant (ADR-0033 R5).
function trustProfile(trust: TrustContext): TrustProfileConfig {
  return { profile: 'public-domain-demo', trustedIssuers: trust.trustedIssuers, allowedRightsStatus: ['public-domain'], requireTrustedIssuer: true };
}

const auditSink: AuditSink = composeSinks(createConsoleAuditSink({ prefix: '[audit bible-mcp]' }));
function audit(action: string, outcome: 'success' | 'denied' | 'error', subjectId: string, context: Record<string, string | number | boolean | null>) {
  void auditSink.write(buildEvent({ action, outcome, actor: { type: 'service', id: 'demo-bible-mcp' }, subject: { type: 'content', id: subjectId }, context }));
}

function policyGate(toolName: string, cls: ToolClassification) {
  return evaluatePolicy({ toolName, classification: cls, callerKind: 'service' });
}

app.get('/health', async (c) => {
  const trust = await resolveTrust(c.env);
  return c.json({ ok: true, service: 'demo-bible-mcp', mode: trust.mode, issuer: trust.issuer, issuerName: trust.issuerName, onchainCorpusAnchoring: !!trust.corpusRootReader });
});

// list_editions — public edition registry.
app.get('/mcp/editions', async (c) => {
  const trust = await resolveTrust(c.env);
  const corpora = await getCorpora(trust);
  const editions = EDITIONS.map((e) => {
    const b = corpora.get(e.edition)!;
    return {
      edition: e.edition, version: e.version, displayName: e.displayName, issuerName: e.issuerName,
      issuer: trust.issuer, language: e.language, accessPolicy: e.accessPolicy, rightsStatus: e.rightsStatus,
      corpusRef: b.manifest.corpusRef, corpusRoot: b.manifest.corpusRoot, verseCount: b.byCanonicalId.size,
    };
  });
  return c.json({ ok: true, editions });
});

// The OSIS book table for the picker UI (from the scripture extension).
app.get('/mcp/books', (c) => c.json({ ok: true, scheme: SCRIPTURE_VERSE_CONTENT_TYPE, books: BOOKS }));

function findRow(corpus: BuiltCorpus, canonicalId: string) {
  return corpus.byCanonicalId.get(canonicalId.toLowerCase());
}

// resolve — CANDIDATE resolution across editions/issuers (spec 266 §3 / §candidate).
app.post('/tools/resolve', async (c) => {
  const gate = policyGate('resolve', RESOLVE_CLS);
  if (gate.decision !== 'allow') return c.json({ ok: false, error: 'policy denied', detail: gate }, 403);

  const body = await c.req
    .json<{ reference?: string; constraints?: ResolutionConstraints }>()
    .catch(() => ({}) as { reference?: string; constraints?: ResolutionConstraints });
  if (!body.reference) return c.json({ ok: false, error: 'reference required' }, 400);

  let parsed;
  try {
    parsed = parseScriptureAlias(body.reference);
  } catch (e) {
    audit('content.resolve', 'denied', body.reference, { reason: (e as Error).message });
    return c.json({ ok: false, error: (e as Error).message }, 400);
  }

  const trust = await resolveTrust(c.env);
  const corpora = await getCorpora(trust);
  // Gather every edition's descriptor for this canonical locus.
  const descriptors: ContentDescriptor[] = [];
  const rowByDescId = new Map<string, { corpus: BuiltCorpus; leafIndex: number }>();
  for (const corpus of corpora.values()) {
    const row = findRow(corpus, parsed.reference.id);
    if (row) {
      descriptors.push(row.descriptor);
      rowByDescId.set(row.descriptor.id, { corpus, leafIndex: row.leafIndex });
    }
  }

  const result = resolveCandidates(parsed.reference, descriptors, trustProfile(trust), body.constraints ?? {});

  // Verify each admitted candidate (issuer signature [ERC-1271 on-chain] + merkle
  // inclusion against the corpusRoot — read FROM CHAIN in on-chain mode, Phase 3).
  const candidates = await Promise.all(
    result.candidates.map(async (cand) => {
      const where = rowByDescId.get(cand.descriptor.id)!;
      let corpusRoot = where.corpus.manifest.corpusRoot;
      let corpusRootSource: 'onchain' | 'manifest' = 'manifest';
      if (trust.corpusRootReader) {
        const anchored = await trust.corpusRootReader(where.corpus.manifest.corpusRef);
        if (anchored) {
          corpusRoot = anchored;
          corpusRootSource = 'onchain';
        }
      }
      const verification = cand.admitted
        ? await verifyContentDescriptor(cand.descriptor, {
            verifySignature: trust.verifySignature,
            corpusRoot,
            inclusionProof: inclusionProof(where.corpus, where.leafIndex),
          })
        : undefined;
      return {
        descriptorId: cand.descriptor.id,
        edition: cand.descriptor.work?.edition,
        issuer: cand.descriptor.issuer,
        issuerName: where.corpus.entry.issuerName,
        accessPolicy: cand.descriptor.accessPolicy,
        proofPolicy: cand.descriptor.proofPolicy,
        rightsStatus: cand.descriptor.work?.rightsStatus,
        selector: cand.descriptor.selector,
        commitment: cand.descriptor.commitment,
        admitted: cand.admitted,
        issuerTrusted: cand.issuerTrusted,
        reason: cand.reason,
        verification,
        corpusRootSource,
        descriptor: cand.descriptor,
      };
    }),
  );

  audit('content.resolve', 'success', parsed.reference.alias ?? body.reference, { canonicalId: parsed.reference.id, candidates: candidates.length });
  return c.json({
    ok: true,
    canonicalReference: { id: parsed.reference.id, alias: parsed.reference.alias, envelope: parsed.reference.envelope },
    display: { reference: `${parsed.book.name} ${parsed.chapter}:${parsed.verse}`, osis: `${parsed.book.osis}.${parsed.chapter}.${parsed.verse}` },
    candidates,
  });
});

// get_passage_text — gated by access policy + entitlement (verifiable-content).
app.post('/tools/get_passage_text', async (c) => {
  const gate = policyGate('get_passage_text', TEXT_CLS);
  if (gate.decision !== 'allow') return c.json({ ok: false, error: 'policy denied', detail: gate }, 403);

  const body = await c.req
    .json<{ reference?: string; edition?: string; entitlement?: Entitlement }>()
    .catch(() => ({}) as { reference?: string; edition?: string; entitlement?: Entitlement });
  if (!body.reference || !body.edition) return c.json({ ok: false, error: 'reference + edition required' }, 400);

  let parsed;
  try {
    parsed = parseScriptureAlias(body.reference);
  } catch (e) {
    return c.json({ ok: false, error: (e as Error).message }, 400);
  }
  const trust = await resolveTrust(c.env);
  const corpus = (await getCorpora(trust)).get(body.edition);
  if (!corpus) return c.json({ ok: false, error: `unknown edition: ${body.edition}` }, 404);
  const row = findRow(corpus, parsed.reference.id);
  if (!row) return c.json({ ok: false, error: `no descriptor for ${parsed.reference.alias} in ${body.edition}` }, 404);

  // Gated editions: the presented Entitlement must be cryptographically signed
  // by the corpus issuer (structural + signature) BEFORE the policy gate.
  let entitlementSigner: string | undefined;
  if (row.descriptor.accessPolicy !== 'public' && body.entitlement) {
    const sig = await verifySignedEntitlement(body.entitlement, corpus.manifest.issuer, trust.verifySignature);
    if (!sig.ok) {
      audit('content.entitlement.verify', 'denied', parsed.reference.alias ?? body.reference, { edition: body.edition, reason: sig.reason ?? 'bad signature' });
      return c.json({ ok: false, error: 'entitlement signature invalid', detail: sig, accessPolicy: row.descriptor.accessPolicy }, 403);
    }
    entitlementSigner = sig.signer;
  }

  const decision = evaluateEntitlement(row.descriptor.accessPolicy, corpus.manifest.corpusRef, body.entitlement);
  if (decision.decision !== 'allow') {
    audit('content.text.access', 'denied', parsed.reference.alias ?? body.reference, { edition: body.edition, reason: decision.reason ?? 'denied' });
    return c.json({ ok: false, error: 'access denied', detail: decision, accessPolicy: row.descriptor.accessPolicy }, 403);
  }

  const text = corpus.entry.texts[row.osis]!;
  const commitmentOk = row.descriptor.commitment ? verifyCommitment(text, row.descriptor.commitment) : false;
  audit('content.text.access', 'success', parsed.reference.alias ?? body.reference, { edition: body.edition, commitmentOk, entitlementSigner: entitlementSigner ?? null });
  return c.json({ ok: true, text, commitment: row.descriptor.commitment, commitmentOk, descriptor: row.descriptor, accessPolicy: row.descriptor.accessPolicy, entitlementSigner });
});

// issue_entitlement — the corpus ISSUER signs an Entitlement VC granting a subject
// access to a (licensed/private) edition. Real EIP-712 signature (dev EOA;
// ERC-1271 SA in production). Demonstrates issuer-signed entitlements vs the
// earlier client-built, unsigned demo entitlement.
app.post('/tools/issue_entitlement', async (c) => {
  const body = await c.req
    .json<{ edition?: string; subject?: string; ttlSeconds?: number }>()
    .catch(() => ({}) as { edition?: string; subject?: string; ttlSeconds?: number });
  if (!body.edition) return c.json({ ok: false, error: 'edition required' }, 400);
  const trust = await resolveTrust(c.env);
  const corpus = (await getCorpora(trust)).get(body.edition);
  if (!corpus) return c.json({ ok: false, error: `unknown edition: ${body.edition}` }, 404);
  if (corpus.manifest.accessPolicy === 'public') {
    return c.json({ ok: false, error: 'public edition needs no entitlement' }, 400);
  }

  const subject = body.subject ?? 'urn:scripture:reader';
  const nowMs = Date.now();
  const unsigned: UnsignedCredential<{ id: string; corpusRef: `0x${string}`; accessPolicy: string }> = {
    '@context': VC_CONTEXTS,
    type: ['VerifiableCredential', 'Entitlement'],
    issuer: `did:ap:issuer:${body.edition}`,
    validFrom: new Date(nowMs - 60_000).toISOString(),
    validUntil: new Date(nowMs + (body.ttlSeconds ?? 31_536_000) * 1000).toISOString(),
    credentialSubject: { id: subject, corpusRef: corpus.manifest.corpusRef, accessPolicy: corpus.manifest.accessPolicy },
  };
  const entitlement = await signCredential(unsigned, trust.credentialSigner);
  audit('content.entitlement.issue', 'success', body.edition, { subject, issuer: corpus.manifest.issuer });
  return c.json({ ok: true, entitlement });
});

// verify_citation — re-check a commitment against the descriptor for a locus.
app.post('/tools/verify_citation', async (c) => {
  const gate = policyGate('verify_citation', VERIFY_CLS);
  if (gate.decision !== 'allow') return c.json({ ok: false, error: 'policy denied', detail: gate }, 403);

  const body = await c.req
    .json<{ reference?: string; edition?: string; commitment?: string }>()
    .catch(() => ({}) as { reference?: string; edition?: string; commitment?: string });
  if (!body.reference || !body.edition || !body.commitment) return c.json({ ok: false, error: 'reference + edition + commitment required' }, 400);

  let parsed;
  try {
    parsed = parseScriptureAlias(body.reference);
  } catch (e) {
    return c.json({ ok: false, error: (e as Error).message }, 400);
  }
  const corpus = (await getCorpora(await resolveTrust(c.env))).get(body.edition);
  const row = corpus && findRow(corpus, parsed.reference.id);
  if (!row) return c.json({ ok: false, error: 'not found' }, 404);
  const expected = row.descriptor.commitment?.value ?? '';
  const matches = expected.toLowerCase() === body.commitment.toLowerCase();
  audit('content.citation.verify', matches ? 'success' : 'denied', parsed.reference.alias ?? body.reference, { edition: body.edition, matches });
  return c.json({ ok: true, matches, expected });
});

export default app;
