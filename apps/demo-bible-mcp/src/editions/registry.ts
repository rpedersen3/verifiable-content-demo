// Edition registry + corpus builder. Adding a translation is a data/config
// drop-in here — NO code change elsewhere (spec 267 R2).
//
// Each edition's off-platform text is ingested into signed ContentDescriptors +
// a Merkle corpusRoot via the generic verifiable-content SDK, keyed by the
// scheme-independent canonicalId (from scripture-content-extension). Text never
// leaves the app store; only commitments are published (ADR-0033 R3).

import { privateKeyToAccount } from 'viem/accounts';
import { recoverAddress, type Hex } from 'viem';
import type { Address } from '@agenticprimitives/types';
import {
  buildContentDescriptor,
  contentCommitment,
  corpusRef,
  buildCorpusTree,
  merkleProof,
  leafHash,
  type ContentDescriptor,
  type CorpusManifest,
  type AccessPolicy,
  type RightsStatus,
  type SignatureVerifier,
  type CorpusTree,
} from '@agenticprimitives/content-primitives';
import {
  parseScriptureAlias,
  SCRIPTURE_VERSE_CONTENT_TYPE,
} from '@agenticprimitives/scripture-content-extension';
import { BSB_VERSES, BSB_EDITION, BSB_VERSION } from '../data/bsb.js';

// DEV-ONLY issuer key. In production each edition is published by a real issuer
// Smart Agent and signed via its ERC-1271 path; here a fixed EOA stands in.
const DEV_ISSUER_PK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
export const issuerAccount = privateKeyToAccount(DEV_ISSUER_PK);
export const DEV_ISSUER: Address = issuerAccount.address;

/** Injected verifier (ADR-0006): dev EOA recovery. Apps wire ERC-1271 in prod. */
export const devSignatureVerifier: SignatureVerifier = async ({ signer, hash, signature }) => {
  try {
    return (await recoverAddress({ hash, signature })).toLowerCase() === signer.toLowerCase();
  } catch {
    return false;
  }
};

export interface EditionEntry {
  edition: string;
  version: string;
  displayName: string;
  /** agent-naming name of the issuer Smart Agent (generic .agent; spec 267 §4). */
  issuerName: string;
  language: string;
  accessPolicy: AccessPolicy;
  rightsStatus: RightsStatus;
  /** OSIS-path -> rendering text (the off-platform store). */
  texts: Record<string, string>;
}

// A mock "licensed" edition: SYNTHETIC placeholder text (NOT a copyrighted work —
// ADR-0033 R1). Exercises the entitlement-gated path.
const MOCK_LICENSED_TEXTS: Record<string, string> = Object.fromEntries(
  Object.keys(BSB_VERSES).map((osis) => [osis, `[Licensed rendering of ${osis} — synthetic demo text; access requires an entitlement.]`]),
);

export const EDITIONS: EditionEntry[] = [
  {
    edition: BSB_EDITION,
    version: BSB_VERSION,
    displayName: 'Berean Standard Bible',
    issuerName: 'bsb.impact',
    language: 'en',
    accessPolicy: 'public',
    rightsStatus: 'public-domain',
    texts: BSB_VERSES,
  },
  {
    edition: 'demo-licensed',
    version: '1',
    displayName: 'Demo Licensed Edition (mock)',
    issuerName: 'demo-licensed.impact',
    language: 'en',
    accessPolicy: 'licensed',
    rightsStatus: 'licensed',
    texts: MOCK_LICENSED_TEXTS,
  },
  // Licensed-BSB: the SAME BSB source text, but published under a LICENSED access policy — every read
  // requires a valid entitlement (request → owner approve → presenter-bound read). Its own corpusRef
  // (distinct from public `bsb`) so entitlements are scoped to it.
  {
    edition: 'lbsb',
    version: BSB_VERSION,
    displayName: 'Licensed BSB',
    issuerName: 'bsb.impact',
    language: 'en',
    accessPolicy: 'licensed',
    rightsStatus: 'licensed',
    texts: BSB_VERSES,
  },
];

export interface DescriptorRow {
  descriptor: ContentDescriptor;
  leafIndex: number;
  /** OSIS path for text lookup. */
  osis: string;
}

export interface BuiltCorpus {
  entry: EditionEntry;
  manifest: CorpusManifest;
  tree: CorpusTree;
  /** canonicalId -> row. */
  byCanonicalId: Map<string, DescriptorRow>;
}

/** The issuer + signing strategy a corpus is built/signed with (dev or on-chain). */
export interface CorpusSigner {
  issuer: Address;
  signDigest: (hash: Hex) => Promise<Hex>;
}

async function buildCorpus(entry: EditionEntry, signer: CorpusSigner): Promise<BuiltCorpus> {
  const ref = corpusRef(signer.issuer, entry.edition, entry.version);
  const osisPaths = Object.keys(entry.texts).sort();

  const rows = osisPaths.map((osis) => {
    const parsed = parseScriptureAlias(osis); // OSIS path → controlled-token canonical locus
    const commitment = contentCommitment(entry.texts[osis]!);
    return { osis, parsed, commitment };
  });

  const tree = buildCorpusTree(rows.map((r) => leafHash(r.commitment.value)));

  const manifest: CorpusManifest = {
    corpusRef: ref,
    issuer: signer.issuer,
    edition: entry.edition,
    version: entry.version,
    scheme: SCRIPTURE_VERSE_CONTENT_TYPE,
    corpusRoot: tree.root,
    accessPolicy: entry.accessPolicy,
    proofPolicy: 'merkle-membership-v1',
    licenseTermsHash: contentCommitment(`license-terms:${entry.edition}:${entry.version}`).value,
  };

  const byCanonicalId = new Map<string, DescriptorRow>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const canonicalId = r.parsed.reference.id;
    const descriptor = await buildContentDescriptor(
      {
        id: `desc_${entry.edition}_${canonicalId.slice(2, 14)}`,
        canonicalId,
        contentType: SCRIPTURE_VERSE_CONTENT_TYPE,
        issuer: { address: signer.issuer, did: `did:ap:issuer:${entry.edition}` },
        issuedAt: '2026-06-07T00:00:00Z',
        status: 'active',
        version: entry.version,
        work: { title: entry.displayName, language: entry.language, edition: entry.edition, rightsStatus: entry.rightsStatus },
        selector: r.parsed.selector as unknown as Record<string, unknown>,
        commitment: r.commitment,
        retrievalPointer: `content://${SCRIPTURE_VERSE_CONTENT_TYPE}/${entry.edition}/${r.osis}`,
        proofPolicy: 'merkle-membership-v1',
        accessPolicy: entry.accessPolicy,
        corpusRef: ref,
      },
      (hash: Hex) => signer.signDigest(hash),
    );
    byCanonicalId.set(canonicalId.toLowerCase(), { descriptor, leafIndex: i, osis: r.osis });
  }

  return { entry, manifest, tree, byCanonicalId };
}

// Cache the built corpora per issuer, so dev + on-chain modes don't collide.
const corporaByIssuer = new Map<string, Promise<Map<string, BuiltCorpus>>>();

/** Build (once per issuer) and cache all editions' corpora for the given signer. */
export function getCorpora(signer: CorpusSigner): Promise<Map<string, BuiltCorpus>> {
  const key = signer.issuer.toLowerCase();
  if (!corporaByIssuer.has(key)) {
    corporaByIssuer.set(
      key,
      (async () => {
        const map = new Map<string, BuiltCorpus>();
        for (const entry of EDITIONS) map.set(entry.edition, await buildCorpus(entry, signer));
        return map;
      })(),
    );
  }
  return corporaByIssuer.get(key)!;
}

export function inclusionProof(corpus: BuiltCorpus, leafIndex: number): Hex[] {
  return merkleProof(corpus.tree, leafIndex);
}
