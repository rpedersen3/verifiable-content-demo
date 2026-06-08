// Populate the full BSB: parse bereanbible.com/bsb.txt (CC0) → canonical loci +
// SHA-256 commitments → one keccak Merkle corpusRoot. Measures the populate time
// and emits a D1 import (verses + corpus meta + ordered leaf commitments) so the
// MCP reads from durable storage and rebuilds NOTHING on reboot.
//
//   pnpm --filter @verifiable-content-demo/bible-mcp exec tsx scripts/build-corpus.ts

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { contentCommitment, leafHash, buildCorpusTree, corpusRef } from '@agenticprimitives/content-primitives';
import { parseScriptureAlias } from '@agenticprimitives/scripture-content-extension';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const EDITION = 'bsb';
const VERSION = '2024';
// The issuer SA (bsb.impact) the corpus is anchored under (Base Sepolia).
const ISSUER = (process.env.ISSUER_SA ?? '0x72D8679435cF288689e157b1AA1F8648A7746851') as `0x${string}`;

function sqlEsc(s: string): string {
  return s.replace(/'/g, "''");
}

async function main() {
  const raw = readFileSync(join(ROOT, '.data', 'bsb.txt'), 'utf8');
  const lines = raw.split('\n');

  const t0 = Date.now();
  const verses: { canonicalId: string; osis: string; text: string }[] = [];
  let unmapped = 0;
  for (let i = 3; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const ref = line.slice(0, tab).trim();
    const text = line.slice(tab + 1).trim();
    try {
      // Normalize BSB book names to the OSIS names the extension knows.
      const m = ref.match(/^(.*) (\d+:\d+)$/);
      const BOOK_ALIAS: Record<string, string> = { Psalm: 'Psalms', 'Song of Solomon': 'Song' };
      const alias = m ? `${BOOK_ALIAS[m[1]!] ?? m[1]} ${m[2]}` : ref;
      const p = parseScriptureAlias(alias);
      const sel = p.selector as unknown as { osis?: string; book?: string; chapter?: number; verse?: number };
      const osis = sel.osis ?? `${sel.book}.${sel.chapter}.${sel.verse}`;
      verses.push({ canonicalId: p.reference.id, osis, text });
    } catch {
      unmapped++;
    }
  }
  const tParse = Date.now();

  // commitments + keccak Merkle root (the populate).
  const commitments = verses.map((v) => contentCommitment(v.text));
  const leaves = commitments.map((c) => leafHash(c.value));
  const tree = buildCorpusTree(leaves);
  const ref = corpusRef(ISSUER, EDITION, VERSION);
  const tBuild = Date.now();

  console.log(`verses parsed:    ${verses.length}  (unmapped ${unmapped})`);
  console.log(`corpusRef:        ${ref}`);
  console.log(`corpusRoot:       ${tree.root}`);
  console.log(`parse:            ${tParse - t0} ms`);
  console.log(`commit+merkle:    ${tBuild - tParse} ms`);
  console.log(`TOTAL populate:   ${tBuild - t0} ms`);

  // Emit D1 import SQL (verses + corpus meta). Leaf commitments live on each
  // verse row (leaf_index ordered) so inclusion proofs need no text + no rebuild.
  mkdirSync(join(ROOT, '.data'), { recursive: true });
  const out: string[] = [];
  out.push('PRAGMA foreign_keys=OFF;');
  out.push(`DELETE FROM verses WHERE edition='${EDITION}';`);
  out.push(`DELETE FROM corpus WHERE edition='${EDITION}';`);
  out.push(`INSERT INTO corpus(edition,version,corpus_ref,corpus_root,leaf_count,issuer) VALUES('${EDITION}','${VERSION}','${ref}','${tree.root}',${verses.length},'${ISSUER}');`);
  // batched multi-row inserts (D1-friendly)
  const B = 50;
  for (let i = 0; i < verses.length; i += B) {
    const chunk = verses.slice(i, i + B).map((v, j) => `('${EDITION}','${v.canonicalId}','${sqlEsc(v.osis)}',${i + j},'${commitments[i + j]!.value}','${sqlEsc(v.text)}')`);
    out.push(`INSERT INTO verses(edition,canonical_id,osis,leaf_index,commitment,text) VALUES ${chunk.join(',')};`);
  }
  const sqlPath = join(ROOT, '.data', 'bsb-import.sql');
  writeFileSync(sqlPath, out.join('\n') + '\n');
  writeFileSync(join(ROOT, '.data', 'corpus-meta.json'), JSON.stringify({ edition: EDITION, version: VERSION, corpusRef: ref, corpusRoot: tree.root, issuer: ISSUER, leafCount: verses.length }, null, 2) + '\n');
  const tEmit = Date.now();
  console.log(`emit D1 import:   ${tEmit - tBuild} ms  → .data/bsb-import.sql (${(out.join('').length / 1e6).toFixed(1)} MB, ${out.length} statements)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
