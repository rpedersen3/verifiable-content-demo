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
