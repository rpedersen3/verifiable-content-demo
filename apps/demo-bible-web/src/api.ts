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

export interface DemoEntitlement {
  '@context': string[];
  type: string[];
  issuer: string;
  validFrom: string;
  credentialSubject: { id: string; corpusRef: string; accessPolicy: string };
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

export async function resolvePassage(reference: string, edition: string, entitlement?: DemoEntitlement): Promise<ResolveResult> {
  const res = await fetch(`${A2A_BASE}/resolve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reference, edition, entitlement, agentRunId: `web_${Date.now()}`, outputId: 'verse-view' }),
  });
  return res.json() as Promise<ResolveResult>;
}

/** Build a demo entitlement matching a corpus (phase-1 policy gate; no signature). */
export function buildDemoEntitlement(corpusRef: string, accessPolicy: string): DemoEntitlement {
  return {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    type: ['VerifiableCredential', 'Entitlement'],
    issuer: 'eip155:31337:0xdemoissuer',
    validFrom: new Date().toISOString(),
    credentialSubject: { id: 'urn:scripture:reader', corpusRef, accessPolicy },
  };
}
