import { A2A_BASE } from './domain';

export interface Edition {
  edition: string;
  version: string;
  displayName: string;
  issuerName: string;
  issuer: string;
  language: string;
  accessPolicy: 'public' | 'licensed' | 'private';
  rightsStatus: string;
  corpusRef: string;
  corpusRoot: string;
  verseCount: number;
}

export interface BibleBook {
  osis: string;
  name: string;
  chapters: number;
}

export interface Candidate {
  descriptorId: string;
  edition?: string;
  issuerName?: string;
  accessPolicy?: string;
  proofPolicy?: string;
  rightsStatus?: string;
  admitted: boolean;
  issuerTrusted: boolean;
  reason?: string;
  verification?: { ok: boolean; reason?: string };
}

export interface ResolveResult {
  ok: boolean;
  error?: string;
  canonicalReference?: { id: string; alias?: string; envelope?: unknown };
  display?: { reference: string; osis: string };
  edition?: string;
  candidates?: Candidate[];
  chosen?: {
    descriptorId: string;
    edition?: string;
    issuerName?: string;
    verification?: { ok: boolean; reason?: string };
    accessPolicy?: string;
    selector?: Record<string, unknown>;
    commitment?: { value: string; algorithm: string; normalization: string };
  };
  accessible?: boolean;
  accessPolicy?: 'public' | 'licensed' | 'private';
  text?: string | null;
  commitmentVerified?: boolean;
  citation?: unknown;
  gate?: unknown;
}

/** A signed Entitlement VC, issued by the corpus issuer (has a `proof`). */
export interface SignedEntitlement {
  '@context': string[];
  type: string[];
  issuer: string;
  validFrom: string;
  validUntil?: string;
  credentialSubject: { id: string; corpusRef: string; accessPolicy: string };
  proof?: { type: string; proofValue: string; created: string };
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${A2A_BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}

export async function fetchEditions(): Promise<Edition[]> {
  return (await getJson<{ ok: boolean; editions: Edition[] }>('/editions')).editions;
}
export async function fetchBooks(): Promise<BibleBook[]> {
  return (await getJson<{ ok: boolean; books: BibleBook[] }>('/books')).books;
}

export async function resolvePassage(reference: string, edition: string, entitlement?: SignedEntitlement): Promise<ResolveResult> {
  const res = await fetch(`${A2A_BASE}/resolve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reference, edition, entitlement, agentRunId: `web_${Date.now()}`, outputId: 'verse-view' }),
  });
  return res.json() as Promise<ResolveResult>;
}

/** Request a SIGNED entitlement from the corpus issuer (the real trust path). */
export async function issueEntitlement(edition: string): Promise<SignedEntitlement> {
  const res = await fetch(`${A2A_BASE}/issue-entitlement`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ edition }),
  });
  const body = (await res.json()) as { ok: boolean; entitlement?: SignedEntitlement; error?: string };
  if (!body.ok || !body.entitlement) throw new Error(body.error ?? 'could not issue entitlement');
  return body.entitlement;
}

export interface AskCitation {
  reference: string;
  edition: string;
  text: string | null;
  canonicalId: string;
  descriptorId: string;
  commitment?: { value: string };
  citation: unknown;
}
export interface AskResult {
  ok: boolean;
  question: string;
  topic: string | null;
  answer: string;
  citations: AskCitation[];
}
export interface VerifyResult {
  ok: boolean;
  agentSignatureValid: boolean;
  signer: string | null;
  expectedAgent: string;
  commitmentMatchesSource: boolean;
}

/** Ask the agent a question — it answers with verifiable signed citations. */
export async function askQuestion(question: string): Promise<AskResult> {
  const res = await fetch(`${A2A_BASE}/ask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question }),
  });
  return res.json() as Promise<AskResult>;
}

/** Independently verify a citation: agent signature + commitment-matches-source. */
export async function verifyCitation(citation: unknown, reference: string, edition: string): Promise<VerifyResult> {
  const res = await fetch(`${A2A_BASE}/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ citation, reference, edition }),
  });
  return res.json() as Promise<VerifyResult>;
}

export interface GraphEdge {
  from: string;
  rel: string;
  to: string;
  meta?: Record<string, unknown>;
}
export interface GraphNode {
  id: string;
  label: string;
  kind: string;
}
export interface TrustValidation {
  ok: boolean;
  reference: string;
  outcome: 'validated' | 'gated' | 'rejected';
  checks: Record<string, { ok: boolean; detail?: string }>;
  attestation?: { credentialSubject?: Record<string, unknown>; proof?: { proofValue?: string } };
  graph?: { nodes: GraphNode[]; edges: GraphEdge[] };
  anchor?: { onchain: boolean; attestationHash?: string; registry?: string; chainId?: number; txHash?: string; alreadyAnchored?: boolean } | null;
  validator?: string;
  services?: { agent?: string; mcp?: string; validator?: string };
}

export interface RangeVerseUI {
  osis: string;
  canonicalId: string;
  leafIndex: number;
  included: boolean;
  text: string;
}
export interface RangeResult {
  ok: boolean;
  range?: string;
  count?: number;
  verified?: number;
  allVerified?: boolean;
  corpusRoot?: string;
  corpusRootSource?: string;
  verses?: RangeVerseUI[];
  error?: string;
}

/** Verify a RANGE of verses (e.g. "John 3:1-16" or a whole chapter "John 3").
 *  Each verse proves Merkle membership in the on-chain-anchored corpus root. */
export async function resolveRange(reference: string, edition = 'bsb'): Promise<RangeResult> {
  const res = await fetch(`${A2A_BASE}/resolve-range`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reference, edition }),
  });
  return res.json() as Promise<RangeResult>;
}

/** Ask the agent to assemble an evidence bundle and have the INDEPENDENT
 *  (hosted) validator check it — returns the outcome, signed attestation + graph. */
export async function validateResponse(reference: string, edition: string): Promise<TrustValidation> {
  const res = await fetch(`${A2A_BASE}/trust/validate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reference, edition }),
  });
  return res.json() as Promise<TrustValidation>;
}
