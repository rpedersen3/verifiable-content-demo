// D1-backed full-BSB corpus: verse text + precomputed corpusRoot + ordered leaf
// commitments live in D1. On the first request per isolate we rebuild ONLY the
// keccak Merkle layers from the stored commitments (≈0.7s, cached) for inclusion
// proofs — never the descriptors (those are built + signed on demand, one per
// request). On reboot the Worker reads from D1; it re-derives nothing from text.

import { buildContentDescriptor, contentCommitment, leafHash, buildCorpusTree, merkleProof, verifyInclusion, type ContentDescriptor } from '@agenticprimitives/content-primitives';
import { SCRIPTURE_VERSE_CONTENT_TYPE, parseScriptureAlias } from '@agenticprimitives/scripture-content-extension';
import type { Hex } from 'viem';
import type { CorpusSigner } from './registry.js';

export interface D1Like {
  prepare(q: string): {
    bind(...a: unknown[]): { first<T = unknown>(): Promise<T | null>; all<T = unknown>(): Promise<{ results: T[] }> };
  };
}

export interface D1Corpus {
  edition: string;
  corpusRef: Hex;
  corpusRoot: Hex;
  issuer: string;
  version: string;
  leafCount: number;
  tree: ReturnType<typeof buildCorpusTree>;
}

const cache = new Map<string, Promise<D1Corpus>>();

/** Load (once per isolate, cached) the corpus meta + rebuild the Merkle layers
 *  from the stored leaf commitments. No descriptor build, no text hashing. */
export function loadD1Corpus(db: D1Like, edition: string): Promise<D1Corpus> {
  if (!cache.has(edition)) {
    cache.set(
      edition,
      (async () => {
        const meta = await db.prepare('SELECT corpus_ref,corpus_root,issuer,version,leaf_count FROM corpus WHERE edition=?').bind(edition).first<{ corpus_ref: string; corpus_root: string; issuer: string; version: string; leaf_count: number }>();
        if (!meta) throw new Error(`no corpus for edition ${edition}`);
        const rows = (await db.prepare('SELECT commitment FROM verses WHERE edition=? ORDER BY leaf_index').bind(edition).all<{ commitment: string }>()).results;
        const tree = buildCorpusTree(rows.map((r) => leafHash(r.commitment as Hex)));
        return { edition, corpusRef: meta.corpus_ref as Hex, corpusRoot: meta.corpus_root as Hex, issuer: meta.issuer, version: meta.version, leafCount: meta.leaf_count, tree };
      })(),
    );
  }
  return cache.get(edition)!;
}

export interface D1Row {
  descriptor: ContentDescriptor;
  leafIndex: number;
  osis: string;
  text: string;
  commitment: { value: string };
}

/** Look up ONE verse by canonical id and build+sign its descriptor on demand. */
export async function findD1Verse(db: D1Like, edition: string, canonicalId: string, corpus: D1Corpus, signer: CorpusSigner): Promise<D1Row | null> {
  const v = await db.prepare('SELECT osis,leaf_index,text FROM verses WHERE edition=? AND canonical_id=?').bind(edition, canonicalId).first<{ osis: string; leaf_index: number; text: string }>();
  if (!v) return null;
  const commitment = contentCommitment(v.text); // deterministic → matches the stored leaf
  const selector = parseScriptureAlias(v.osis).selector as unknown as Record<string, unknown>;
  const descriptor = await buildContentDescriptor(
    {
      id: `desc_${edition}_${String(canonicalId).slice(2, 14)}`,
      canonicalId: canonicalId as Hex,
      contentType: SCRIPTURE_VERSE_CONTENT_TYPE,
      issuer: { address: signer.issuer, did: `did:ap:issuer:${edition}` },
      issuedAt: '2024-01-01T00:00:00Z',
      status: 'active',
      version: corpus.version,
      work: { title: 'Berean Standard Bible', language: 'en', edition, rightsStatus: 'public-domain' },
      selector,
      commitment,
      retrievalPointer: `content://${SCRIPTURE_VERSE_CONTENT_TYPE}/${edition}/${v.osis}`,
      proofPolicy: 'merkle-membership-v1',
      accessPolicy: 'public',
      corpusRef: corpus.corpusRef,
    },
    (h) => signer.signDigest(h),
  );
  return { descriptor, leafIndex: v.leaf_index, osis: v.osis, text: v.text, commitment };
}

export function d1InclusionProof(corpus: D1Corpus, leafIndex: number): Hex[] {
  return merkleProof(corpus.tree, leafIndex);
}

export interface RangeVerse {
  osis: string;
  canonicalId: string;
  leafIndex: number;
  commitment: string;
  text: string;
  included: boolean;
  inclusionProof: Hex[];
}

/** Resolve every verse under `osisPrefix` (book.chapter) optionally filtered to
 *  [vStart,vEnd], and verify each one's Merkle membership against `root`. Local
 *  + fast for any range — the issuer's authority is the single on-chain anchor. */
export async function findD1Range(db: D1Like, edition: string, osisPrefix: string, vStart: number | undefined, vEnd: number | undefined, corpus: D1Corpus, root: Hex, max = 250): Promise<RangeVerse[]> {
  const rows = (await db.prepare('SELECT osis,canonical_id,leaf_index,commitment,text FROM verses WHERE edition=? AND osis LIKE ? ORDER BY leaf_index').bind(edition, `${osisPrefix}.%`).all<{ osis: string; canonical_id: string; leaf_index: number; commitment: string; text: string }>()).results;
  const out: RangeVerse[] = [];
  for (const r of rows) {
    const v = Number(r.osis.split('.').pop());
    if (vStart != null && v < vStart) continue;
    if (vEnd != null && v > vEnd) continue;
    const proof = merkleProof(corpus.tree, r.leaf_index);
    const included = verifyInclusion(leafHash(r.commitment as Hex), proof, root);
    out.push({ osis: r.osis, canonicalId: r.canonical_id, leafIndex: r.leaf_index, commitment: r.commitment, text: r.text, included, inclusionProof: proof });
    if (out.length >= max) break;
  }
  return out;
}
