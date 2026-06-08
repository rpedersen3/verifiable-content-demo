// Build the paragraph (logical-grouping) index for the verse popup. Reads our BSB osis→leaf_index
// (from .data/bsb-import.sql) and the BSB USFX paragraphing (.data/sources/bsb.usfx.xml), maps USFX
// book codes to OSIS by canonical order, and records the leaf_index where each paragraph begins.
//   node scripts/parse-passages.mjs   (writes .data/ontology/passages.sql)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const OUT = join(ROOT, '.data', 'ontology');
const usfxFile = join(ROOT, '.data', 'sources', 'bsb.usfx.xml');
if (!existsSync(usfxFile)) { console.warn('no bsb.usfx.xml — run fetch-sources first'); process.exit(0); }

// osis -> leaf_index (capture only first 4 cols; ignore verse text which may contain quotes/commas)
const sql = readFileSync(join(ROOT, '.data', 'bsb-import.sql'), 'utf8');
const leafOf = new Map(); const bookOrder = []; const seen = new Set();
for (const m of sql.matchAll(/\('bsb','0x[0-9a-f]+','([^']+)',(\d+),/g)) {
  const osis = m[1]; leafOf.set(osis, +m[2]);
  const b = osis.split('.')[0]; if (!seen.has(b)) { seen.add(b); bookOrder.push(b); }
}
// USFX book codes in canonical order → map to our OSIS book codes by position
const usfx = readFileSync(usfxFile, 'utf8');
const usfxBooks = []; const ub = new Set();
for (const m of usfx.matchAll(/bcv="([A-Z0-9]+)\.\d+\.\d+"/g)) { const b = m[1]; if (!ub.has(b)) { ub.add(b); usfxBooks.push(b); } }
const bookMap = new Map(); usfxBooks.forEach((b, i) => bookMap.set(b, bookOrder[i]));

// scan in document order: <p> and <c> open a new paragraph; the next verse is its start
const starts = new Set([0]); let pending = true, mapped = 0, miss = 0;
const re = /<(p|c)\b|bcv="([A-Z0-9]+)\.(\d+)\.(\d+)"/g; let m;
while ((m = re.exec(usfx))) {
  if (m[1]) { pending = true; continue; }
  if (!pending) continue;
  const osis = `${bookMap.get(m[2])}.${m[3]}.${m[4]}`; const leaf = leafOf.get(osis);
  if (leaf != null) { starts.add(leaf); mapped++; } else miss++;
  pending = false;
}
const sorted = [...starts].sort((a, b) => a - b);
writeFileSync(join(OUT, 'passages.sql'), 'DELETE FROM paragraph;\n' + sorted.map((i) => `INSERT INTO paragraph(start_idx) VALUES(${i});`).join('\n') + '\n');
console.log('books', usfxBooks.length, '| paragraph starts', sorted.length, '| mapped', mapped, '| unmapped', miss);
