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
    bind(...a: unknown[]): { first<T = unknown>(): Promise<T | null>; all<T = unknown>(): Promise<{ results: T[] }>; run(): Promise<unknown> };
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

/** Leaf index of a specific verse (by canonical id), or null. */
export async function leafIndexFor(db: D1Like, edition: string, canonicalId: string): Promise<number | null> {
  const r = await db.prepare('SELECT leaf_index FROM verses WHERE edition=? AND canonical_id=?').bind(edition, canonicalId).first<{ leaf_index: number }>();
  return r ? r.leaf_index : null;
}

/** Min/max leaf index of a chapter (osisPrefix = "Book.Chapter"), or null. */
export async function chapterBounds(db: D1Like, edition: string, osisPrefix: string): Promise<{ min: number; max: number } | null> {
  const r = await db.prepare('SELECT min(leaf_index) AS mn, max(leaf_index) AS mx FROM verses WHERE edition=? AND osis LIKE ?').bind(edition, `${osisPrefix}.%`).first<{ mn: number | null; mx: number | null }>();
  return r && r.mn != null ? { min: r.mn, max: r.mx! } : null;
}

/** Every verse in the global-order range [startLeaf,endLeaf] (spans chapters),
 *  each verified for Merkle membership against `root`. Local + fast; the issuer's
 *  authority is the single on-chain anchor. */
export async function findD1RangeByLeaf(db: D1Like, edition: string, startLeaf: number, endLeaf: number, corpus: D1Corpus, root: Hex, max = 400): Promise<RangeVerse[]> {
  const rows = (await db.prepare('SELECT osis,canonical_id,leaf_index,commitment,text FROM verses WHERE edition=? AND leaf_index BETWEEN ? AND ? ORDER BY leaf_index LIMIT ?').bind(edition, startLeaf, endLeaf, max).all<{ osis: string; canonical_id: string; leaf_index: number; commitment: string; text: string }>()).results;
  return rows.map((r) => {
    const proof = merkleProof(corpus.tree, r.leaf_index);
    return { osis: r.osis, canonicalId: r.canonical_id, leafIndex: r.leaf_index, commitment: r.commitment, text: r.text, included: verifyInclusion(leafHash(r.commitment as Hex), proof, root), inclusionProof: proof };
  });
}
