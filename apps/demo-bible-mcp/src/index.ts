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
import { loadD1Corpus, findD1Verse, findD1RangeByLeaf, leafIndexFor, chapterBounds, d1InclusionProof, type D1Like } from './editions/d1.js';
import { verifySignedEntitlement } from './lib/trust.js';
import { resolveTrust, type McpEnv, type TrustContext } from './lib/trust-context.js';
import { handleA2aRpcBody } from '@agenticprimitives/a2a';
import { buildBsbAgent, type A2aEnv } from './a2a/agent.js';
export { BsbTaskDO } from './a2a/task-do.js';
import { AgentNamingClient, namehash, agentNameRegistryAbi } from '@agenticprimitives/agent-naming';
import { agentAccountAbi } from '@agenticprimitives/agent-account';
import { createPublicClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';
import type { Hex, Address } from 'viem';

// Is `addr` a custodian of the AgentAccount `agentSa`? (on-chain isCustodian). Lets the controller of
// bsb.impact claim while signing in as their OWN identity — no hardcoding, all read live on-chain.
async function isBsbCustodian(env: { A2A_RPC_URL?: string }, agentSa: Address, addr: string): Promise<boolean> {
  if (!env.A2A_RPC_URL || !agentSa || !addr.startsWith('0x')) return false;
  try {
    const client = createPublicClient({ chain: baseSepolia, transport: http(env.A2A_RPC_URL) });
    const r = await Promise.race([
      client.readContract({ address: agentSa, abi: agentAccountAbi, functionName: 'isCustodian', args: [addr as Address] }) as Promise<boolean>,
      new Promise<boolean>((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000)),
    ]);
    return r === true;
  } catch { return false; }
}

// Who CONTROLS the bsb.impact name node on-chain (AgentNameRegistry.owner(namehash)). The corpus
// owner must be this address (or the resolved agent). Returns null on no-RPC / timeout.
async function resolveBsbController(env: { A2A_RPC_URL?: string; A2A_NAME_REGISTRY?: string }, agentName = 'bsb.impact'): Promise<string | null> {
  if (!env.A2A_RPC_URL) return null;
  try {
    const client = createPublicClient({ chain: baseSepolia, transport: http(env.A2A_RPC_URL) });
    const registry = (env.A2A_NAME_REGISTRY ?? '0x15F7ed064A230C011b0244A14fD9653f011d609B') as Address;
    const owner = await Promise.race([
      client.readContract({ address: registry, abi: agentNameRegistryAbi, functionName: 'owner', args: [namehash(agentName)] }) as Promise<string>,
      new Promise<string>((_, rej) => setTimeout(() => rej(new Error('controller timeout')), 8000)),
    ]);
    return owner ? String(owner).toLowerCase() : null;
  } catch { return null; }
}

// Resolve the agent that controls `bsb.impact` on-chain (agent-naming). The corpus owner MUST be
// this agent — its canonical CAIP-10 id. Returns null if no RPC or the name is unregistered.
async function resolveBsbOwnerId(env: { A2A_RPC_URL?: string; A2A_CHAIN_ID?: string; A2A_NAME_REGISTRY?: string; A2A_NAME_RESOLVER?: string }, agentName = 'bsb.impact'): Promise<{ id: string | null; sa: string | null }> {
  if (!env.A2A_RPC_URL) return { id: null, sa: null };
  const chainId = Number(env.A2A_CHAIN_ID ?? '84532');
  const client = new AgentNamingClient({
    rpcUrl: env.A2A_RPC_URL,
    chainId,
    registry: (env.A2A_NAME_REGISTRY ?? '0x15F7ed064A230C011b0244A14fD9653f011d609B') as Address,
    universalResolver: (env.A2A_NAME_RESOLVER ?? '0x7d777d2d0bbc1806B9Cc779121C27fbaAaFDb60b') as Address,
  });
  try {
    const sa = await Promise.race([
      client.resolveName(agentName),
      new Promise<null>((_, rej) => setTimeout(() => rej(new Error('resolve timeout')), 8000)),
    ]);
    return { id: sa ? `eip155:${chainId}:${sa.toLowerCase()}` : null, sa: sa ? sa.toLowerCase() : null };
  } catch { return { id: null, sa: null }; }
}

type Relay = { fetch: (url: string, init?: RequestInit) => Promise<Response> };
type Env = McpEnv & { DB?: D1Like; ONT?: Relay; ONT_URL?: string; A2A_RELAY?: Relay; RELAY_URL?: string; RELAY_ORIGIN?: string; BSB_TASK_DO?: DurableObjectNamespace } & A2aEnv;

// Deliver a granted entitlement VC into the READER's personal demo-mcp vault, RIGHT AWAY at grant
// time, by presenting the reader's captured connect-delegation to the relayer's set_vault_record
// (demo-mcp keys the record by the delegation's delegator = the reader). Best-effort: on failure the
// reader can still pick the VC up from the issuer ledger (list_entitlements). The reader signs nothing.
async function deliverEntitlementToVault(env: Env, readerDelegation: { delegate?: string }, edition: string, vc: unknown): Promise<{ delivered: boolean; reason?: string }> {
  try {
    const origin = env.RELAY_ORIGIN ?? 'https://demo-bible-ontology-production.richardpedersen3.workers.dev';
    const base = env.RELAY_URL ?? 'https://demo-a2a-production.richardpedersen3.workers.dev';
    const rfetch = (path: string, init?: RequestInit) => (env.A2A_RELAY ? env.A2A_RELAY.fetch(`https://relay${path}`, init) : fetch(`${base}${path}`, init));
    const csrf = (await (await rfetch('/auth/csrf', { headers: { origin } })).json()) as { token?: string };
    if (!csrf.token) return { delivered: false, reason: 'no csrf token' };
    const res = await rfetch('/mcp/vault/set', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf.token, origin },
      body: JSON.stringify({ delegation: readerDelegation, requester: readerDelegation.delegate, recordType: `entitlement:bsb:${edition}`, data: vc }),
    });
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    return j.ok ? { delivered: true } : { delivered: false, reason: j.error ?? `relay ${res.status}` };
  } catch (e) { return { delivered: false, reason: (e as Error).message }; }
}
// Vault data source: the Bible ontology worker (entities, relationships, verses,
// trust signals, class tree). Service binding in prod; public URL in dev.
const ontBase = (env: Env) => env.ONT_URL ?? 'https://demo-bible-ontology-production.richardpedersen3.workers.dev';
const ontFetch = (env: Env, path: string) => (env.ONT ? env.ONT.fetch(`https://ont${path}`) : fetch(`${ontBase(env)}${path}`)).then((r) => r.json() as Promise<Record<string, unknown>>);
const ontPost = (env: Env, path: string, body: unknown) => (env.ONT ? env.ONT.fetch(`https://ont${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) : fetch(`${ontBase(env)}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).then((r) => r.json() as Promise<Record<string, unknown>>);

const app = new Hono<{ Bindings: Env }>();
app.use('*', cors());

const RESOLVE_CLS: ToolClassification = { '@sa-tool': 'service-only', '@sa-auth': 'service-hmac', '@sa-risk-tier': 'low' };
const TEXT_CLS: ToolClassification = { '@sa-tool': 'service-only', '@sa-auth': 'service-hmac', '@sa-risk-tier': 'low', '@sa-validation': 'json-schema' };
const VERIFY_CLS: ToolClassification = { '@sa-tool': 'service-only', '@sa-auth': 'service-hmac', '@sa-risk-tier': 'low' };
declareTool({ name: 'resolve' }, RESOLVE_CLS);
declareTool({ name: 'get_passage_text' }, TEXT_CLS);
declareTool({ name: 'verify_citation' }, VERIFY_CLS);
// Scripture-Agent vault tools (read the ontology graph; trust signals are signed VCs).
const VAULT_CLS: ToolClassification = { '@sa-tool': 'service-only', '@sa-auth': 'service-hmac', '@sa-risk-tier': 'low' };
declareTool({ name: 'get_entity' }, VAULT_CLS);
declareTool({ name: 'find_entities' }, VAULT_CLS);
declareTool({ name: 'get_trust_signals' }, VAULT_CLS);
declareTool({ name: 'submit_feedback' }, VAULT_CLS);
declareTool({ name: 'graph_query' }, VAULT_CLS);
declareTool({ name: 'get_passage' }, VAULT_CLS);

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

// corpus — the edition's PUBLIC descriptor commitments, ordered by leaf index.
// A validator builds the issuer's Poseidon tree from these to verify a zk
// membership proof (no text is exposed — commitments are already public).
app.get('/corpus/:edition', async (c) => {
  const edition = c.req.param('edition');
  if (c.env.DB && edition === 'bsb') {
    const d1 = await loadD1Corpus(c.env.DB, 'bsb');
    // Full corpus: meta only. Per-leaf commitments (for zk) come from a paginated
    // endpoint (Phase 4 — deferred); 31k inline would be ~2 MB.
    return c.json({ ok: true, edition, corpusRef: d1.corpusRef, corpusRoot: d1.corpusRoot, leafCount: d1.leafCount, commitments: [] });
  }
  const trust = await resolveTrust(c.env);
  const corpus = (await getCorpora(trust)).get(edition);
  if (!corpus) return c.json({ ok: false, error: 'unknown edition' }, 404);
  const rows = [...corpus.byCanonicalId.values()].sort((a, b) => a.leafIndex - b.leafIndex);
  return c.json({
    ok: true,
    edition: c.req.param('edition'),
    corpusRef: corpus.manifest.corpusRef,
    corpusRoot: corpus.manifest.corpusRoot,
    commitments: rows.map((r) => r.descriptor.commitment?.value ?? '').filter((v) => v.length > 0),
  });
});

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
  // Gather candidates for this locus: the FULL BSB from D1 (when bound), plus the
  // embedded editions (e.g. the gated demo-licensed one). Normalize each so verify
  // works regardless of source.
  type Where = { corpusRef: Hex; corpusRoot: Hex; leafIndex: number; inclusion: () => Hex[]; issuerName: string };
  const descriptors: ContentDescriptor[] = [];
  const rowByDescId = new Map<string, Where>();

  const d1 = c.env.DB ? await loadD1Corpus(c.env.DB, 'bsb').catch(() => null) : null;
  if (d1 && c.env.DB) {
    const r = await findD1Verse(c.env.DB, 'bsb', parsed.reference.id, d1, trust).catch(() => null);
    if (r) {
      descriptors.push(r.descriptor);
      rowByDescId.set(r.descriptor.id, { corpusRef: d1.corpusRef, corpusRoot: d1.corpusRoot, leafIndex: r.leafIndex, inclusion: () => d1InclusionProof(d1, r.leafIndex), issuerName: 'bsb.impact' });
    }
  }
  for (const corpus of (await getCorpora(trust)).values()) {
    if (d1 && corpus.entry.edition === 'bsb') continue; // bsb served from D1
    const row = findRow(corpus, parsed.reference.id);
    if (row) {
      descriptors.push(row.descriptor);
      rowByDescId.set(row.descriptor.id, { corpusRef: corpus.manifest.corpusRef, corpusRoot: corpus.manifest.corpusRoot, leafIndex: row.leafIndex, inclusion: () => inclusionProof(corpus, row.leafIndex), issuerName: corpus.entry.issuerName });
    }
  }

  const result = resolveCandidates(parsed.reference, descriptors, trustProfile(trust), body.constraints ?? {});

  // Verify each admitted candidate (issuer signature [ERC-1271 on-chain] + merkle
  // inclusion against the corpusRoot — read FROM CHAIN in on-chain mode, Phase 3).
  const candidates = await Promise.all(
    result.candidates.map(async (cand) => {
      const where = rowByDescId.get(cand.descriptor.id)!;
      let corpusRoot = where.corpusRoot;
      let corpusRootSource: 'onchain' | 'manifest' = 'manifest';
      if (trust.corpusRootReader) {
        const anchored = await trust.corpusRootReader(where.corpusRef);
        if (anchored) {
          corpusRoot = anchored;
          corpusRootSource = 'onchain';
        }
      }
      const incl = where.inclusion();
      const verification = cand.admitted
        ? await verifyContentDescriptor(cand.descriptor, { verifySignature: trust.verifySignature, corpusRoot, inclusionProof: incl })
        : undefined;
      return {
        descriptorId: cand.descriptor.id,
        edition: cand.descriptor.work?.edition,
        issuer: cand.descriptor.issuer,
        issuerName: where.issuerName,
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
        corpusRef: where.corpusRef,
        corpusRoot,
        inclusionProof: incl,
        leafIndex: where.leafIndex,
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

// resolve_range — verify a RANGE of verses. Supports single-chapter
// ("John 3:1-16"), whole chapter ("John 3"), chapter range ("John 1-3"), and
// CROSS-chapter ("John 1:1-John 3:16" or "John 1:1-3:16"). Each verse proves
// Merkle membership in the issuer's on-chain-anchored corpusRoot — local + fast
// (the issuer's authority is the one anchor).
type RangeRef = { book: string; chapter: number; verse?: number };
function parseRef(s: string, inheritBook?: string, inheritChapter?: number, leftHadVerse?: boolean): RangeRef | null {
  s = s.trim();
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(.+?)\s+(\d+):(\d+)$/))) return { book: m[1]!, chapter: +m[2]!, verse: +m[3]! };
  if ((m = s.match(/^(.+?)\s+(\d+)$/))) return { book: m[1]!, chapter: +m[2]! };
  if (!inheritBook) return null;
  if ((m = s.match(/^(\d+):(\d+)$/))) return { book: inheritBook, chapter: +m[1]!, verse: +m[2]! };
  if ((m = s.match(/^(\d+)$/))) {
    const n = +m[1]!;
    // bare N on the right of a range: a VERSE if the left had one, else a CHAPTER.
    return leftHadVerse && inheritChapter != null ? { book: inheritBook, chapter: inheritChapter, verse: n } : { book: inheritBook, chapter: n };
  }
  return null;
}
function parseRange(input: string): { start: RangeRef; end: RangeRef } | null {
  const s = input.trim().replace(/[–—]/g, '-');
  const dash = s.indexOf('-');
  if (dash < 0) {
    const r = parseRef(s);
    return r ? { start: r, end: r } : null;
  }
  const start = parseRef(s.slice(0, dash).trim());
  if (!start) return null;
  const end = parseRef(s.slice(dash + 1).trim(), start.book, start.chapter, start.verse != null);
  return end ? { start, end } : null;
}

app.post('/tools/resolve_range', async (c) => {
  const gate = policyGate('resolve', RESOLVE_CLS);
  if (gate.decision !== 'allow') return c.json({ ok: false, error: 'policy denied', detail: gate }, 403);
  const body = await c.req.json<{ reference?: string; edition?: string }>().catch(() => ({}) as { reference?: string });
  if (!body.reference) return c.json({ ok: false, error: 'reference required' }, 400);
  if (!c.env.DB) return c.json({ ok: false, error: 'range needs the full-BSB D1 corpus' }, 503);
  const r = parseRange(body.reference);
  if (!r) return c.json({ ok: false, error: `unrecognized range: "${body.reference}"` }, 400);

  const trust = await resolveTrust(c.env);
  const corpus = await loadD1Corpus(c.env.DB, 'bsb');
  let corpusRoot = corpus.corpusRoot;
  let corpusRootSource: 'onchain' | 'manifest' = 'manifest';
  if (trust.corpusRootReader) {
    const anchored = await trust.corpusRootReader(corpus.corpusRef);
    if (anchored) {
      corpusRoot = anchored;
      corpusRootSource = 'onchain';
    }
  }

  // Resolve start/end to global leaf indices (spans chapters via verse order).
  let display: string;
  let startLeaf: number | null;
  let endLeaf: number | null;
  try {
    const sp = parseScriptureAlias(`${r.start.book} ${r.start.chapter}:1`);
    const ep = parseScriptureAlias(`${r.end.book} ${r.end.chapter}:1`);
    startLeaf = r.start.verse != null ? await leafIndexFor(c.env.DB, 'bsb', parseScriptureAlias(`${r.start.book} ${r.start.chapter}:${r.start.verse}`).reference.id) : (await chapterBounds(c.env.DB, 'bsb', `${sp.book.osis}.${r.start.chapter}`))?.min ?? null;
    endLeaf = r.end.verse != null ? await leafIndexFor(c.env.DB, 'bsb', parseScriptureAlias(`${r.end.book} ${r.end.chapter}:${r.end.verse}`).reference.id) : (await chapterBounds(c.env.DB, 'bsb', `${ep.book.osis}.${r.end.chapter}`))?.max ?? null;
    const sLabel = `${sp.book.name} ${r.start.chapter}${r.start.verse != null ? ':' + r.start.verse : ''}`;
    const eLabel = `${ep.book.name} ${r.end.chapter}${r.end.verse != null ? ':' + r.end.verse : ''}`;
    display = sLabel === eLabel ? sLabel : `${sLabel} – ${eLabel}`;
  } catch (e) {
    return c.json({ ok: false, error: (e as Error).message }, 400);
  }
  if (startLeaf == null || endLeaf == null) return c.json({ ok: false, error: `range endpoints not found for ${display}` }, 404);
  if (startLeaf > endLeaf) [startLeaf, endLeaf] = [endLeaf, startLeaf];

  const verses = await findD1RangeByLeaf(c.env.DB, 'bsb', startLeaf, endLeaf, corpus, corpusRoot);
  if (!verses.length) return c.json({ ok: false, error: `no verses for ${display}` }, 404);
  const verified = verses.filter((v) => v.included).length;
  audit('content.resolve_range', 'success', display, { count: verses.length, verified });
  return c.json({
    ok: true,
    edition: 'bsb',
    range: display,
    corpusRef: corpus.corpusRef,
    corpusRoot,
    corpusRootSource,
    count: verses.length,
    verified,
    allVerified: verified === verses.length,
    verses: verses.map((v) => ({ osis: v.osis, canonicalId: v.canonicalId, leafIndex: v.leafIndex, commitment: v.commitment, included: v.included, text: v.text })),
  });
});

// get_passage_text — gated by access policy + entitlement (verifiable-content).
app.post('/tools/get_passage_text', async (c) => {
  const gate = policyGate('get_passage_text', TEXT_CLS);
  if (gate.decision !== 'allow') return c.json({ ok: false, error: 'policy denied', detail: gate }, 403);

  const body = await c.req
    .json<{ reference?: string; edition?: string; entitlement?: Entitlement; subject?: string }>()
    .catch(() => ({}) as { reference?: string; edition?: string; entitlement?: Entitlement; subject?: string });
  if (!body.reference || !body.edition) return c.json({ ok: false, error: 'reference + edition required' }, 400);

  let parsed;
  try {
    parsed = parseScriptureAlias(body.reference);
  } catch (e) {
    return c.json({ ok: false, error: (e as Error).message }, 400);
  }
  const trust = await resolveTrust(c.env);
  // Full BSB (public) is served from D1 when bound — text + on-demand descriptor.
  if (c.env.DB && body.edition === 'bsb') {
    const d1 = await loadD1Corpus(c.env.DB, 'bsb');
    const r = await findD1Verse(c.env.DB, 'bsb', parsed.reference.id, d1, trust);
    if (!r) return c.json({ ok: false, error: `no verse for ${parsed.reference.alias} in bsb` }, 404);
    const commitmentOk = !!r.descriptor.commitment && verifyCommitment(r.text, r.descriptor.commitment);
    audit('content.text.access', 'success', parsed.reference.alias ?? body.reference, { edition: 'bsb', commitmentOk });
    return c.json({ ok: true, text: r.text, commitment: r.descriptor.commitment, commitmentOk, descriptor: r.descriptor, accessPolicy: 'public' });
  }
  const corpus = (await getCorpora(trust)).get(body.edition);
  if (!corpus) return c.json({ ok: false, error: `unknown edition: ${body.edition}` }, 404);
  const row = findRow(corpus, parsed.reference.id);
  if (!row) return c.json({ ok: false, error: `no descriptor for ${parsed.reference.alias} in ${body.edition}` }, 404);

  // Gated editions — TWO ways in (spec 272): a free GRANT (issuer-signed, presenter-bound, non-revoked
  // Entitlement) OR a paid PREPAID pass (x402). A forged VC is always a hard error; absence/expiry/
  // revocation of a grant falls THROUGH to the prepaid path; no pass either ⇒ 402 (payment required).
  let entitlementSigner: string | undefined;
  if (row.descriptor.accessPolicy !== 'public') {
    let grantOk = false;
    if (body.entitlement) {
      const sig = await verifySignedEntitlement(body.entitlement, corpus.manifest.issuer, trust.verifySignature);
      if (!sig.ok) { // a presented VC that doesn't verify is forgery — hard fail, never fall through
        audit('content.entitlement.verify', 'denied', parsed.reference.alias ?? body.reference, { edition: body.edition, reason: sig.reason ?? 'bad signature' });
        return c.json({ ok: false, error: 'entitlement signature invalid', detail: sig, accessPolicy: row.descriptor.accessPolicy }, 403);
      }
      entitlementSigner = sig.signer;
      const decision = evaluateEntitlement(row.descriptor.accessPolicy, corpus.manifest.corpusRef, body.entitlement);
      const entSubject = (body.entitlement?.credentialSubject as { id?: string } | undefined)?.id;
      const presenterOk = !(body.subject && entSubject && body.subject.toLowerCase() !== entSubject.toLowerCase());
      let revoked = false;
      if (c.env.DB && entSubject) {
        const led = await c.env.DB.prepare('SELECT status FROM entitlements_issued WHERE subject=? AND edition=? ORDER BY id DESC LIMIT 1').bind(entSubject, body.edition).first<{ status: string }>();
        revoked = !!led && led.status === 'revoked';
      }
      grantOk = decision.decision === 'allow' && presenterOk && !revoked;
    }
    if (!grantOk) {
      // PREPAID (x402): consume one read off an active paid pass for the verified subject.
      let prepaidOk = false;
      if (c.env.DB && body.subject) {
        const now = new Date().toISOString();
        const pre = await c.env.DB.prepare("SELECT id, max_uses, used FROM prepaid_entitlements WHERE subject=? AND edition=? AND status='active' AND used < max_uses AND (valid_until IS NULL OR valid_until > ?) ORDER BY id ASC LIMIT 1").bind(body.subject, body.edition, now).first<{ id: number; max_uses: number; used: number }>();
        if (pre) {
          const used = pre.used + 1;
          await c.env.DB.prepare('UPDATE prepaid_entitlements SET used=?, status=? WHERE id=?').bind(used, used >= pre.max_uses ? 'exhausted' : 'active', pre.id).run();
          prepaidOk = true;
        }
      }
      if (!prepaidOk) {
        audit('content.text.access', 'denied', parsed.reference.alias ?? body.reference, { edition: body.edition, reason: 'payment required' });
        return c.json({ ok: false, error: `payment required for ${body.edition}`, gated: body.edition, reason: 'payment required', accessPolicy: row.descriptor.accessPolicy }, 402);
      }
    }
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
    .json<{ edition?: string; subject?: string; ttlSeconds?: number; requestId?: number; issuedBySub?: string }>()
    .catch(() => ({}) as { edition?: string; subject?: string; ttlSeconds?: number; requestId?: number; issuedBySub?: string });
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
    // The verifier requires a CAIP-10 eip155 issuer matching the signer (not a did:) — else the
    // structural check rejects it before the signature is even verified.
    issuer: `eip155:${trust.credentialSigner.chainId}:${trust.credentialSigner.issuerAddress}`,
    validFrom: new Date(nowMs - 60_000).toISOString(),
    validUntil: new Date(nowMs + (body.ttlSeconds ?? 31_536_000) * 1000).toISOString(),
    credentialSubject: { id: subject, corpusRef: corpus.manifest.corpusRef, accessPolicy: corpus.manifest.accessPolicy },
  };
  const entitlement = await signCredential(unsigned, trust.credentialSigner);
  // Issuer revocation + audit ledger (the CANONICAL held copy is the VC in the reader's vault).
  if (c.env.DB) {
    const now = new Date(nowMs).toISOString();
    await c.env.DB.prepare('INSERT INTO entitlements_issued(request_id,edition,subject,issued_by_sub,entitlement,valid_until,status,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .bind(body.requestId ?? null, body.edition, subject, body.issuedBySub ?? null, JSON.stringify(entitlement), unsigned.validUntil ?? null, 'granted', now).run();
    if (body.requestId) await c.env.DB.prepare("UPDATE entitlement_requests SET status='granted', decided_at=?, decided_by_sub=? WHERE id=?").bind(now, body.issuedBySub ?? null, body.requestId).run();
  }
  // Deliver the VC into the reader's own demo-mcp vault RIGHT AWAY (locked decision), using the
  // delegation captured at request time. Best-effort — the issuer ledger is the pickup fallback.
  let delivery: { delivered: boolean; reason?: string } = { delivered: false, reason: 'no captured reader delegation' };
  if (c.env.DB && body.requestId) {
    const row = await c.env.DB.prepare('SELECT reader_delegation FROM entitlement_requests WHERE id=?').bind(body.requestId).first<{ reader_delegation: string | null }>();
    if (row?.reader_delegation) {
      try { delivery = await deliverEntitlementToVault(c.env, JSON.parse(row.reader_delegation) as { delegate?: string }, body.edition, entitlement); }
      catch (e) { delivery = { delivered: false, reason: (e as Error).message }; }
    }
  }
  audit('content.entitlement.issue', 'success', body.edition, { subject, issuer: corpus.manifest.issuer, delivered: delivery.delivered });
  return c.json({ ok: true, entitlement, delivery });
});

// request_entitlement — a reader asks for access (subject comes from a verified id_token upstream,
// never typed). Captures the reader's delegation so the grant can be delivered to their vault.
app.post('/tools/request_entitlement', async (c) => {
  const b = await c.req.json<{ subject?: string; subjectName?: string; edition?: string; note?: string; readerDelegation?: unknown }>().catch(() => ({}) as Record<string, never>);
  if (!b.subject || !b.edition) return c.json({ ok: false, error: 'subject and edition required' }, 400);
  if (!c.env.DB) return c.json({ ok: false, error: 'no store' }, 503);
  const now = new Date().toISOString();
  const r = await c.env.DB.prepare('INSERT INTO entitlement_requests(subject,subject_name,edition,note,status,reader_delegation,created_at) VALUES(?,?,?,?,?,?,?)')
    .bind(b.subject, b.subjectName ?? null, b.edition, String(b.note ?? '').slice(0, 500), 'pending', b.readerDelegation ? JSON.stringify(b.readerDelegation) : null, now).run();
  audit('content.entitlement.request', 'success', b.edition, { subject: b.subject });
  return c.json({ ok: true, requestId: (r as { meta?: { last_row_id?: number } })?.meta?.last_row_id ?? null });
});

// list_entitlements — the reader's currently-granted entitlement VCs (the pull/pickup path).
app.post('/tools/list_entitlements', async (c) => {
  const b = await c.req.json<{ subject?: string }>().catch(() => ({}) as { subject?: string });
  if (!b.subject) return c.json({ ok: false, error: 'subject required' }, 400);
  if (!c.env.DB) return c.json({ ok: true, entitlements: [] });
  const rows = (await c.env.DB.prepare("SELECT edition, entitlement, valid_until FROM entitlements_issued WHERE subject=? AND status='granted' ORDER BY id DESC").bind(b.subject).all<{ edition: string; entitlement: string; valid_until: string }>()).results;
  return c.json({ ok: true, entitlements: rows.map((r) => ({ edition: r.edition, validUntil: r.valid_until, entitlement: JSON.parse(r.entitlement) })) });
});

// list_requests — the owner's approval queue (demo-corpus). Owner-gated upstream.
app.post('/tools/list_requests', async (c) => {
  const b = await c.req.json<{ status?: string; subject?: string; edition?: string }>().catch(() => ({}) as { status?: string; subject?: string; edition?: string });
  if (!c.env.DB) return c.json({ ok: true, requests: [] });
  // subject filter = a reader's own requests (all statuses); else the owner's queue by status, scoped
  // to one edition when given (so each corpus manager sees only its own corpus's requests).
  const status = ['pending', 'granted', 'denied'].includes(String(b.status)) ? String(b.status) : 'pending';
  const rows = b.subject
    ? (await c.env.DB.prepare('SELECT id, subject, subject_name, edition, note, status, created_at, decided_at FROM entitlement_requests WHERE subject=? ORDER BY id DESC LIMIT 200').bind(b.subject).all()).results
    : b.edition
      ? (await c.env.DB.prepare('SELECT id, subject, subject_name, edition, note, status, created_at FROM entitlement_requests WHERE status=? AND edition=? ORDER BY id DESC LIMIT 200').bind(status, b.edition).all()).results
      : (await c.env.DB.prepare('SELECT id, subject, subject_name, edition, note, status, created_at FROM entitlement_requests WHERE status=? ORDER BY id DESC LIMIT 200').bind(status).all()).results;
  return c.json({ ok: true, requests: rows });
});

// verify_access — does `subject` have access to `edition`? Public editions: always. Licensed: requires
// a granted, non-expired, non-revoked entitlement. The gate behind ALL Explorer queries when a licensed
// Bible is active (the reader's content access is bound to their entitlement).
app.post('/tools/verify_access', async (c) => {
  const b = await c.req.json<{ edition?: string; subject?: string }>().catch(() => ({}) as { edition?: string; subject?: string });
  const edition = String(b.edition ?? 'bsb');
  const entry = EDITIONS.find((e) => e.edition === edition);
  const policy = entry?.accessPolicy ?? (edition === 'bsb' ? 'public' : 'licensed');
  if (policy === 'public') return c.json({ ok: true, allowed: true, edition, policy: 'public' });
  if (!b.subject) return c.json({ ok: true, allowed: false, edition, policy, reason: 'sign-in required' });
  if (!c.env.DB) return c.json({ ok: true, allowed: false, edition, policy, reason: 'no store' });
  // Lane 1 — GRANT: an owner-issued entitlement (the demo-corpus approval flow).
  const led = await c.env.DB.prepare("SELECT status, valid_until FROM entitlements_issued WHERE subject=? AND edition=? AND status='granted' ORDER BY id DESC LIMIT 1").bind(b.subject, edition).first<{ status: string; valid_until: string | null }>();
  if (led && (!led.valid_until || new Date(led.valid_until).getTime() >= Date.now())) return c.json({ ok: true, allowed: true, edition, policy: 'licensed', via: 'grant' });
  // Lane 2 — PREPAID: an active, unexpired prepaid pass with reads remaining (x402 'entitlement' lane).
  const pre = await c.env.DB.prepare("SELECT id FROM prepaid_entitlements WHERE subject=? AND edition=? AND status='active' AND used < max_uses AND (valid_until IS NULL OR valid_until > ?) LIMIT 1").bind(b.subject, edition, new Date().toISOString()).first();
  if (pre) return c.json({ ok: true, allowed: true, edition, policy: 'licensed', via: 'prepaid' });
  // Neither — the caller (lbsb A2A gate) decides: 402 settlement (x402) or 403.
  return c.json({ ok: true, allowed: false, edition, policy, reason: 'no entitlement or prepaid balance' });
});

// ── x402 pay-per-use ledger (spec 272 consumer) ──
// record_settlement — the lbsb scripture service records an on-chain charge (reader → treasury).
app.post('/tools/record_settlement', async (c) => {
  const b = await c.req.json<{ edition?: string; payer?: string; payee?: string; asset?: string; amount?: string; reference?: string; resourceHash?: string; mandateId?: string; nonce?: string; settlementHash?: string; lane?: string }>().catch(() => ({}) as Record<string, never>);
  if (!c.env.DB) return c.json({ ok: false, error: 'no store' }, 503);
  if (!b.edition || !b.payer || !b.payee) return c.json({ ok: false, error: 'edition, payer, payee required' }, 400);
  await c.env.DB.prepare('INSERT INTO payments_settled(edition,payer,payee,asset,amount,reference,resource_hash,mandate_id,nonce,settlement_hash,lane,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(b.edition, b.payer, b.payee, b.asset ?? null, b.amount ?? null, b.reference ?? null, b.resourceHash ?? null, b.mandateId ?? null, b.nonce ?? null, b.settlementHash ?? null, b.lane ?? 'settlement', new Date().toISOString()).run();
  audit('content.payment.settle', 'success', b.edition, { payer: b.payer, amount: b.amount ?? null, lane: b.lane ?? 'settlement' });
  return c.json({ ok: true });
});

// check_settlement — replay guard: has this on-chain settlement already been consumed for a pass?
app.post('/tools/check_settlement', async (c) => {
  const b = await c.req.json<{ settlementHash?: string }>().catch(() => ({}) as { settlementHash?: string });
  if (!c.env.DB || !b.settlementHash) return c.json({ ok: true, seen: false });
  const row = await c.env.DB.prepare('SELECT id FROM payments_settled WHERE settlement_hash=? LIMIT 1').bind(b.settlementHash).first();
  return c.json({ ok: true, seen: !!row });
});

// (Removed the FAUCET_PK faucet_usdc mint tool — no service-held key. Funding a person-treasury is now a
//  client-side CUSTODIAN mint: the reader's own wallet calls MockUSDC.mint, paying gas. The home creates
//  the treasury SA in the member's Portal.)
const USDC_ABI = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;

// usdc_balance — read-only mock-USDC balance of an address (no mint, no gas, no key). For the Explorer
// admin "my treasury" lane. INERT (configured:false) until the RPC + token are set.
app.post('/tools/usdc_balance', async (c) => {
  const b = await c.req.json<{ address?: string }>().catch(() => ({}) as Record<string, never>);
  const env = c.env as unknown as { A2A_RPC_URL?: string; PAY_ASSET?: string };
  if (!env.A2A_RPC_URL || !env.PAY_ASSET) return c.json({ ok: true, configured: false, balance: '0', usdc: '0' });
  if (!b.address || !/^0x[0-9a-fA-F]{40}$/.test(b.address)) return c.json({ ok: false, error: 'address required' }, 400);
  try {
    const pc = createPublicClient({ chain: baseSepolia, transport: http(env.A2A_RPC_URL) });
    const bal = (await pc.readContract({ address: env.PAY_ASSET as `0x${string}`, abi: USDC_ABI, functionName: 'balanceOf', args: [b.address as `0x${string}`] })) as bigint;
    return c.json({ ok: true, configured: true, address: b.address, asset: env.PAY_ASSET, balance: bal.toString(), usdc: (Number(bal) / 1e6).toString() });
  } catch (e) { return c.json({ ok: false, error: (e as Error).message, configured: true }); }
});

// list_settlements — the treasury ledger for an edition (owner Treasury tab) or a reader's own charges.
app.post('/tools/list_settlements', async (c) => {
  const b = await c.req.json<{ edition?: string; payer?: string; limit?: number }>().catch(() => ({}) as { edition?: string; payer?: string; limit?: number });
  if (!c.env.DB) return c.json({ ok: true, settlements: [], total: '0' });
  const edition = String(b.edition ?? 'lbsb');
  const lim = Math.min(500, Math.max(1, Number(b.limit ?? 200)));
  const rows = b.payer
    ? (await c.env.DB.prepare('SELECT id,edition,payer,payee,asset,amount,reference,settlement_hash,lane,created_at FROM payments_settled WHERE edition=? AND payer=? ORDER BY id DESC LIMIT ?').bind(edition, b.payer, lim).all()).results
    : (await c.env.DB.prepare('SELECT id,edition,payer,payee,asset,amount,reference,settlement_hash,lane,created_at FROM payments_settled WHERE edition=? ORDER BY id DESC LIMIT ?').bind(edition, lim).all()).results;
  const tot = await c.env.DB.prepare('SELECT COALESCE(SUM(CAST(amount AS INTEGER)),0) t FROM payments_settled WHERE edition=?').bind(edition).first<{ t: number }>();
  return c.json({ ok: true, settlements: rows, total: String(tot?.t ?? 0) });
});

// mint_prepaid — record a prepaid entitlement (one settlement → N reads; the x402 'entitlement' lane).
app.post('/tools/mint_prepaid', async (c) => {
  const b = await c.req.json<{ edition?: string; subject?: string; maxUses?: number; validUntil?: string; record?: unknown; settlementHash?: string }>().catch(() => ({}) as Record<string, never>);
  if (!c.env.DB) return c.json({ ok: false, error: 'no store' }, 503);
  if (!b.edition || !b.subject) return c.json({ ok: false, error: 'edition, subject required' }, 400);
  await c.env.DB.prepare('INSERT INTO prepaid_entitlements(edition,subject,record,max_uses,used,valid_until,status,settlement_hash,created_at) VALUES(?,?,?,?,0,?,?,?,?)')
    .bind(b.edition, b.subject, b.record ? JSON.stringify(b.record) : null, Math.max(1, Number(b.maxUses ?? 1)), b.validUntil ?? null, 'active', b.settlementHash ?? null, new Date().toISOString()).run();
  audit('content.payment.prepaid', 'success', b.edition, { subject: b.subject, maxUses: b.maxUses ?? 1 });
  return c.json({ ok: true });
});

// consume_prepaid — spend one read off an active prepaid balance (no on-chain tx).
app.post('/tools/consume_prepaid', async (c) => {
  const b = await c.req.json<{ edition?: string; subject?: string }>().catch(() => ({}) as { edition?: string; subject?: string });
  if (!c.env.DB) return c.json({ ok: true, allowed: false, reason: 'no store' });
  if (!b.subject || !b.edition) return c.json({ ok: true, allowed: false, reason: 'subject, edition required' });
  const now = new Date().toISOString();
  const row = await c.env.DB.prepare("SELECT id, max_uses, used FROM prepaid_entitlements WHERE subject=? AND edition=? AND status='active' AND used < max_uses AND (valid_until IS NULL OR valid_until > ?) ORDER BY id ASC LIMIT 1").bind(b.subject, b.edition, now).first<{ id: number; max_uses: number; used: number }>();
  if (!row) return c.json({ ok: true, allowed: false, reason: 'no prepaid balance' });
  const used = row.used + 1;
  await c.env.DB.prepare('UPDATE prepaid_entitlements SET used=?, status=? WHERE id=?').bind(used, used >= row.max_uses ? 'exhausted' : 'active', row.id).run();
  return c.json({ ok: true, allowed: true, remaining: row.max_uses - used });
});

// list_prepaid — a reader's prepaid balances (the budget meter).
app.post('/tools/list_prepaid', async (c) => {
  const b = await c.req.json<{ subject?: string; edition?: string }>().catch(() => ({}) as { subject?: string; edition?: string });
  if (!c.env.DB || !b.subject) return c.json({ ok: true, prepaid: [] });
  const rows = b.edition
    ? (await c.env.DB.prepare("SELECT id, edition, max_uses, used, valid_until, status, created_at FROM prepaid_entitlements WHERE subject=? AND edition=? ORDER BY id DESC LIMIT 50").bind(b.subject, b.edition).all()).results
    : (await c.env.DB.prepare("SELECT id, edition, max_uses, used, valid_until, status, created_at FROM prepaid_entitlements WHERE subject=? ORDER BY id DESC LIMIT 50").bind(b.subject).all()).results;
  return c.json({ ok: true, prepaid: rows });
});

// get_service_identity — who (if anyone) owns a service. Public read (the owner_sub is an agent id).
app.post('/tools/get_service_identity', async (c) => {
  const b = await c.req.json<{ service?: string }>().catch(() => ({}) as { service?: string });
  if (!c.env.DB) return c.json({ ok: true, identity: null });
  const row = await c.env.DB.prepare('SELECT service, issuer_agent_id, owner_sub, delegate_address, created_at FROM service_identity WHERE service=?').bind(String(b.service ?? 'bsb-archive')).first();
  return c.json({ ok: true, identity: row ?? null });
});

// get_owner_id — resolve who controls bsb.impact on-chain (the required corpus owner). For the UI + tests.
app.post('/tools/get_owner_id', async (c) => {
  const b = await c.req.json<{ addr?: string; name?: string }>().catch(() => ({}) as { addr?: string; name?: string });
  const name = String(b.name ?? 'bsb.impact');
  const r = await resolveBsbOwnerId(c.env as never, name);
  const controller = await resolveBsbController(c.env as never, name);
  // Optionally check whether `addr` (e.g. a connecting user's SA) is a custodian of the agent's account.
  const addr = b.addr ? (b.addr.includes(':') ? b.addr.split(':').pop()! : b.addr) : null;
  const isCustodian = addr && r.sa ? await isBsbCustodian(c.env as never, r.sa as Address, addr) : null;
  return c.json({ ok: true, name, resolvedAgentSa: r.sa, resolvedAgentId: r.id, nameController: controller, queriedAddr: addr, isCustodian, source: r.id || controller ? 'agent-naming (on-chain)' : 'unresolved' });
});

// claim_service — ownership bound to bsb.impact (live agent-naming): only its controller may claim
// (records owner_sub from their verified id_token). Re-claim only by the same owner. The operational
// KMS delegate + on-chain delegation (Flow A / P0) fill delegate_address + delegation later.
app.post('/tools/claim_service', async (c) => {
  const b = await c.req.json<{ service?: string; ownerSub?: string; issuerAgentId?: string; agentName?: string }>().catch(() => ({}) as Record<string, never>);
  if (!c.env.DB) return c.json({ ok: false, error: 'no store' }, 503);
  if (!b.ownerSub) return c.json({ ok: false, error: 'ownerSub required' }, 400);
  const service = String(b.service ?? 'bsb-archive');
  const agentName = String(b.agentName ?? b.issuerAgentId ?? 'bsb.impact');
  const existing = await c.env.DB.prepare('SELECT owner_sub FROM service_identity WHERE service=?').bind(service).first<{ owner_sub: string }>();
  // Ownership bound to the service agent via LIVE ANS (no hardcoded address): the claimant must be the
  // agent the name resolves to, OR a custodian of that account (read on-chain from agent-naming + agent-account).
  const resolved = await resolveBsbOwnerId(c.env as never, agentName);
  const subSa = b.ownerSub.includes(':') ? b.ownerSub.split(':').pop()!.toLowerCase() : b.ownerSub.toLowerCase();
  const ansAuthorized = resolved.sa ? (subSa === resolved.sa.toLowerCase() || (await isBsbCustodian(c.env as never, resolved.sa as Address, subSa))) : false;
  const now = new Date().toISOString();
  if (existing) {
    if (existing.owner_sub.toLowerCase() === b.ownerSub.toLowerCase()) {
      return c.json({ ok: true, claimed: false, isOwner: true, ownerSub: existing.owner_sub });
    }
    // TAKEOVER hardening: the ANS-authorized controller reclaims from a NON-canonical owner (a stale or
    // wrong claim self-corrects the moment the real bsb.impact controller connects — no DB surgery).
    const existingIsCanonical = !!resolved.id && existing.owner_sub.toLowerCase() === resolved.id.toLowerCase();
    if (ansAuthorized && !existingIsCanonical) {
      await c.env.DB.prepare('UPDATE service_identity SET owner_sub=?, created_at=? WHERE service=?').bind(b.ownerSub, now, service).run();
      audit('content.service.takeover', 'success', service, { newOwner: b.ownerSub, previousOwner: existing.owner_sub });
      return c.json({ ok: true, claimed: true, takeover: true, isOwner: true, ownerSub: b.ownerSub, previousOwner: existing.owner_sub });
    }
    return c.json({ ok: true, claimed: false, isOwner: false, ownerSub: existing.owner_sub, reason: existingIsCanonical ? `corpus owned by the canonical ${agentName} agent` : 'not the corpus owner' });
  }
  // Unclaimed: only the ANS-authorized controller may claim; if ANS is unresolvable (no RPC / timeout) fall back to first-claim-wins.
  if (resolved.sa && !ansAuthorized) {
    return c.json({ ok: true, claimed: false, isOwner: false, ownerSub: resolved.id, reason: `only ${agentName} (per ANS), or a custodian of its account, may claim this corpus` });
  }
  await c.env.DB.prepare('INSERT INTO service_identity(service, issuer_agent_id, owner_sub, delegate_address, delegation, created_at) VALUES(?,?,?,?,?,?)')
    .bind(service, b.issuerAgentId ?? agentName, b.ownerSub, '', '', now).run();
  audit('content.service.claim', 'success', service, { ownerSub: b.ownerSub });
  return c.json({ ok: true, claimed: true, isOwner: true, ownerSub: b.ownerSub });
});

// list_issued — the owner's issued-entitlement ledger (for review + revocation). Owner-gated upstream.
app.post('/tools/list_issued', async (c) => {
  const b = await c.req.json<{ status?: string; edition?: string }>().catch(() => ({}) as { status?: string; edition?: string });
  if (!c.env.DB) return c.json({ ok: true, issued: [] });
  const st = ['granted', 'revoked'].includes(String(b.status)) ? String(b.status) : 'granted';
  const rows = b.edition
    ? (await c.env.DB.prepare('SELECT id, request_id, edition, subject, issued_by_sub, valid_until, status, created_at FROM entitlements_issued WHERE status=? AND edition=? ORDER BY id DESC LIMIT 200').bind(st, b.edition).all()).results
    : (await c.env.DB.prepare('SELECT id, request_id, edition, subject, issued_by_sub, valid_until, status, created_at FROM entitlements_issued WHERE status=? ORDER BY id DESC LIMIT 200').bind(st).all()).results;
  return c.json({ ok: true, issued: rows });
});

// deny_request — owner declines a pending request (owner-gated upstream).
app.post('/tools/deny_request', async (c) => {
  const b = await c.req.json<{ id?: number; reason?: string; deniedBySub?: string }>().catch(() => ({}) as Record<string, never>);
  if (!c.env.DB) return c.json({ ok: false, error: 'no store' }, 503);
  if (!b.id) return c.json({ ok: false, error: 'id required' }, 400);
  await c.env.DB.prepare("UPDATE entitlement_requests SET status='denied', decided_at=?, decided_by_sub=?, note=COALESCE(note,'')||? WHERE id=? AND status='pending'")
    .bind(new Date().toISOString(), b.deniedBySub ?? null, b.reason ? ` [denied: ${String(b.reason).slice(0, 120)}]` : '', b.id).run();
  return c.json({ ok: true });
});

// revoke_entitlement — online revocation (gated reads re-check the ledger). Owner-gated upstream.
app.post('/tools/revoke_entitlement', async (c) => {
  const b = await c.req.json<{ id?: number; subject?: string; edition?: string }>().catch(() => ({}) as Record<string, never>);
  if (!c.env.DB) return c.json({ ok: false, error: 'no store' }, 503);
  let n = 0;
  if (b.id) { await c.env.DB.prepare("UPDATE entitlements_issued SET status='revoked' WHERE id=?").bind(b.id).run(); n = 1; }
  else if (b.subject && b.edition) { await c.env.DB.prepare("UPDATE entitlements_issued SET status='revoked' WHERE subject=? AND edition=? AND status='granted'").bind(b.subject, b.edition).run(); n = 1; }
  else return c.json({ ok: false, error: 'id or (subject+edition) required' }, 400);
  audit('content.entitlement.revoke', 'success', b.edition ?? String(b.id ?? ''), { subject: b.subject ?? '' });
  return c.json({ ok: true, revoked: n });
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

// ── Scripture-Agent vault: the Bible ontology graph (entities, relationships,
// verses, trust signals, class tree), served as policy-gated, audited MCP tools.
// Trust signals are returned as a SIGNED Verifiable Credential. ──
async function resolveEntityId(env: Env, body: { id?: string; q?: string; kind?: string }): Promise<{ id?: string; label?: string }> {
  if (body.id) return { id: body.id };
  if (!body.q) return {};
  const d = await ontFetch(env, `/api/search?q=${encodeURIComponent(body.q)}${body.kind ? `&kind=${encodeURIComponent(body.kind)}` : ''}`);
  const r = (d.results as { id: string; label: string }[] | undefined)?.[0];
  return r ? { id: r.id, label: r.label } : {};
}

app.post('/tools/find_entities', async (c) => {
  const gate = policyGate('find_entities', VAULT_CLS);
  if (gate.decision !== 'allow') return c.json({ ok: false, error: 'policy denied', detail: gate }, 403);
  const b = await c.req.json<{ q?: string; kind?: string; book?: string }>().catch(() => ({}) as { q?: string; kind?: string; book?: string });
  if (!b.q && !b.kind && !b.book) return c.json({ ok: false, error: 'q, kind, or book required' }, 400);
  const qs = [b.q ? `q=${encodeURIComponent(b.q)}` : '', b.kind ? `kind=${encodeURIComponent(b.kind)}` : '', b.book ? `book=${encodeURIComponent(b.book)}` : ''].filter(Boolean).join('&');
  const d = await ontFetch(c.env, `/api/search?${qs}`);
  const results = (d.results as Record<string, unknown>[] | undefined) ?? [];
  audit('vault.find_entities', 'success', b.q ?? b.kind ?? b.book ?? '', { count: results.length });
  return c.json({ ok: true, results: results.map((r) => ({ id: r.id, label: r.label, kind: r.kind, disambig: r.disambig, verses: r.verses })) });
});

app.post('/tools/get_entity', async (c) => {
  const gate = policyGate('get_entity', VAULT_CLS);
  if (gate.decision !== 'allow') return c.json({ ok: false, error: 'policy denied', detail: gate }, 403);
  const b = await c.req.json<{ id?: string; q?: string; kind?: string }>().catch(() => ({}) as { id?: string; q?: string; kind?: string });
  const { id } = await resolveEntityId(c.env, b);
  if (!id) return c.json({ ok: false, error: 'entity not found' }, 404);
  const d = await ontFetch(c.env, `/api/node/${encodeURIComponent(id)}`);
  if (!d.ok) return c.json({ ok: false, error: 'not found' }, 404);
  const n = (d.node ?? {}) as Record<string, unknown>;
  audit('vault.get_entity', 'success', id, { label: String(n.label ?? '') });
  return c.json({ ok: true, entity: { id: n.id, label: n.label, kind: n.kind, disambig: n.disambig }, classChain: d.classChain, relationships: { out: d.out, in: d.in }, verseCount: d.verseCount, verses: d.verses, signals: d.signals, scores: d.scores });
});

app.post('/tools/get_trust_signals', async (c) => {
  const gate = policyGate('get_trust_signals', VAULT_CLS);
  if (gate.decision !== 'allow') return c.json({ ok: false, error: 'policy denied', detail: gate }, 403);
  const b = await c.req.json<{ id?: string; q?: string; kind?: string }>().catch(() => ({}) as { id?: string; q?: string; kind?: string });
  const { id } = await resolveEntityId(c.env, b);
  if (!id) return c.json({ ok: false, error: 'entity not found' }, 404);
  const d = await ontFetch(c.env, `/api/node/${encodeURIComponent(id)}`);
  if (!d.ok) return c.json({ ok: false, error: 'not found' }, 404);
  const n = (d.node ?? {}) as Record<string, unknown>;
  const dimensions = ((d.scores as Record<string, unknown>[] | undefined) ?? []).map((s) => ({ dimension: s.dimension, value: s.value, basis: s.basis, verse: (s as { osis?: string }).osis ?? null }));
  const actions = ((d.signals as Record<string, unknown>[] | undefined) ?? []).map((s) => ({ polarity: s.polarity, basis: s.basis, verse: s.osis }));
  const trust = await resolveTrust(c.env);
  const nowMs = Date.now();
  const unsigned: UnsignedCredential<{ id: string; label: string; dimensions: unknown[]; actions: unknown[] }> = {
    '@context': VC_CONTEXTS,
    type: ['VerifiableCredential', 'TrustProfileCredential'],
    issuer: `eip155:${trust.credentialSigner.chainId}:${trust.credentialSigner.issuerAddress}`,
    validFrom: new Date(nowMs - 60_000).toISOString(),
    credentialSubject: { id, label: String(n.label ?? ''), dimensions, actions },
  };
  const credential = await signCredential(unsigned, trust.credentialSigner);
  audit('vault.get_trust_signals', 'success', id, { label: String(n.label ?? ''), dimensions: dimensions.length, actions: actions.length });
  return c.json({ ok: true, entity: { id, label: n.label, kind: n.kind }, dimensions, actions, credential });
});

// submit_feedback — a connected user's challenge/agreement on a trust signal, minted as a
// SIGNED feedback assertion (ERC-8004-style attestation) and stored in the vault. Carries the
// full (entity, signal, verse) target + verdict + proposed correction so the Scripture Agent /
// vault can later act on it to update the signal for this person↔verse relationship.
app.post('/tools/submit_feedback', async (c) => {
  const gate = policyGate('submit_feedback', VAULT_CLS);
  if (gate.decision !== 'allow') return c.json({ ok: false, error: 'policy denied', detail: gate }, 403);
  const b = await c.req.json<{
    target?: { entityId?: string; entityLabel?: string; signalKind?: string; basis?: string; verse?: string };
    stance?: string; verdict?: string; score?: number; comment?: string; agentRationale?: string;
    proposedCorrection?: { action?: string; note?: string };
    author?: { agentId?: string; name?: string };
  }>().catch(() => ({}) as Record<string, never>);
  const t = b.target ?? {};
  if (!t.entityId || !b.comment) return c.json({ ok: false, error: 'target.entityId and comment required' }, 400);
  if (!b.author?.agentId) return c.json({ ok: false, error: 'author.agentId required (connect first)' }, 401);
  const stance = ['agree', 'challenge', 'note'].includes(String(b.stance)) ? String(b.stance) : 'note';
  const trust = await resolveTrust(c.env);
  const nowMs = Date.now();
  const subject = {
    target: { entityId: t.entityId, entityLabel: t.entityLabel ?? '', signalKind: t.signalKind ?? '', basis: t.basis ?? '', verse: t.verse ?? '' },
    feedback: { stance, verdict: b.verdict ?? null, score: typeof b.score === 'number' ? b.score : null, comment: String(b.comment).slice(0, 1500), agentRationale: b.agentRationale ? String(b.agentRationale).slice(0, 4000) : null },
    proposedCorrection: { action: b.proposedCorrection?.action ?? null, note: b.proposedCorrection?.note ?? null },
    author: { agentId: b.author.agentId, name: b.author.name ?? '' },
  };
  const unsigned: UnsignedCredential<typeof subject> = {
    '@context': VC_CONTEXTS,
    type: ['VerifiableCredential', 'TrustSignalFeedback'],
    issuer: `eip155:${trust.credentialSigner.chainId}:${trust.credentialSigner.issuerAddress}`,
    validFrom: new Date(nowMs - 60_000).toISOString(),
    credentialSubject: subject,
  };
  const assertion = await signCredential(unsigned, trust.credentialSigner);
  // Persist into the ontology's public feedback thread (with the structured fields + signed assertion).
  await ontPost(c.env, '/api/feedback', {
    subject_id: t.entityId, subject_label: t.entityLabel ?? '', sig_kind: t.signalKind ?? '', basis: t.basis ?? '', osis: t.verse ?? '',
    stance, verdict: b.verdict ?? '', comment: String(b.comment).slice(0, 1500), author: b.author.name || b.author.agentId, author_sub: b.author.agentId,
    proposed_action: b.proposedCorrection?.action ?? '', assertion: JSON.stringify(assertion),
  });
  audit('vault.submit_feedback', 'success', t.entityId, { stance, verdict: b.verdict ?? '', author: b.author.agentId, verse: t.verse ?? '' });
  return c.json({ ok: true, assertion });
});

// graph_query — the vault's read gateway to the Bible knowledge graph: forwards an
// allowlisted ontology GET path (/api/*) to the data layer (ONT binding) and returns it.
// This is what lets clients get ALL entity/signal/verse/relationship data through the
// vault (via the Scripture Agent) rather than calling the data Worker directly.
app.post('/tools/graph_query', async (c) => {
  const gate = policyGate('graph_query', VAULT_CLS);
  if (gate.decision !== 'allow') return c.json({ ok: false, error: 'policy denied', detail: gate }, 403);
  const b = await c.req.json<{ path?: string }>().catch(() => ({}) as { path?: string });
  const path = String(b.path ?? '');
  if (!path.startsWith('/api/') || path.includes('..') || path.length > 800) return c.json({ ok: false, error: 'invalid path' }, 400);
  const d = await ontFetch(c.env, path);
  audit('vault.graph_query', 'success', path.split('?')[0] ?? path, {});
  return c.json(d);
});

// get_passage — verse TEXT from the canonical BSB corpus (this Worker's D1), returning a
// readable, chapter-clamped window around the cited verse. The single source of verse text.
app.post('/tools/get_passage', async (c) => {
  const gate = policyGate('get_passage', VAULT_CLS);
  if (gate.decision !== 'allow') return c.json({ ok: false, error: 'policy denied', detail: gate }, 403);
  const b = await c.req.json<{ osis?: string }>().catch(() => ({}) as { osis?: string });
  const osis = String(b.osis ?? '').trim();
  if (!osis) return c.json({ ok: false, error: 'osis required' }, 400);
  if (!c.env.DB) return c.json({ ok: false, error: 'corpus unavailable' }, 503);
  const ed = 'bsb';
  const hot = await c.env.DB.prepare('SELECT leaf_index AS li FROM verses WHERE edition=? AND osis=?').bind(ed, osis).first<{ li: number }>();
  if (!hot) return c.json({ ok: false, error: 'verse not found', osis }, 404);
  const ch = osis.split('.').slice(0, 2).join('.');
  const cb = await c.env.DB.prepare('SELECT min(leaf_index) lo, max(leaf_index) hi FROM verses WHERE edition=? AND osis LIKE ?').bind(ed, `${ch}.%`).first<{ lo: number; hi: number }>();
  const start = Math.max(cb?.lo ?? hot.li, hot.li - 5);
  const end = Math.min(cb?.hi ?? hot.li, hot.li + 5);
  const verses = (await c.env.DB.prepare('SELECT osis, text FROM verses WHERE edition=? AND leaf_index BETWEEN ? AND ? ORDER BY leaf_index').bind(ed, start, end).all<{ osis: string; text: string }>()).results;
  audit('vault.get_passage', 'success', osis, { count: verses.length });
  return c.json({ ok: true, osis, edition: ed, verses });
});

// Class tree (Global Church Ontology inheritance) — public.
app.get('/mcp/class_tree', async (c) => {
  const d = await ontFetch(c.env, '/api/classes');
  return c.json({ ok: true, classes: d.classes ?? [] });
});

// ── BSB Corpus-Manager A2A agent surface (spec 269 async, delegation-authorized bus) ──
// Inert until A2A_RPC_URL + A2A_AGENT_SA (the claimed bsb.impact) are configured: the on-chain
// checks fail closed, so every inbound task is denied. Set those to activate the bus.
app.get('/.well-known/agent-card.json', (c) => c.json(buildBsbAgent(c.env).agentCard()));
app.post('/api/a2a', async (c) => {
  // Durable per-agent task mailbox (one DO per agent SA) → tasks persist + alarm-driven processing.
  const ns = c.env.BSB_TASK_DO;
  if (ns) {
    const agentSA = String(c.env.A2A_AGENT_SA ?? '0x0000000000000000000000000000000000000000').toLowerCase();
    return ns.get(ns.idFromName(agentSA)).fetch(c.req.raw);
  }
  // Fallback (no DO bound): in-memory, non-persistent.
  const body = await c.req.text();
  try {
    return c.json(await handleA2aRpcBody(buildBsbAgent(c.env), body));
  } catch (e) {
    return c.json({ jsonrpc: '2.0', id: null, error: { code: -32603, message: (e as Error).message } });
  }
});

export default app;
