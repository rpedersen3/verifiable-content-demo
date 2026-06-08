// Fetch the raw external source dumps into .data/sources/ (gitignored — we commit only the derived
// A-box + provenance, never the raw datasets; STEPBible asks not to redistribute its file). Run
// before build-ontology.mjs when refreshing. Sources: STEPBible TIPNR (CC BY) + OpenBible (CC BY).
//   node scripts/fetch-sources.mjs
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const OUT = join(ROOT, '.data', 'sources');
mkdirSync(OUT, { recursive: true });
const UA = { 'User-Agent': 'verifiable-content-demo/0.1 (richardpedersen3@gmail.com) bible-ontology' };

const FILES = [
  ['tipnr.txt', 'https://raw.githubusercontent.com/STEPBible/STEPBible-Data/master/Proper%20Nouns/TIPNR%20-%20Translators%20Individualised%20Proper%20Names%20with%20all%20References%20-%20STEPBible.org%20CC%20BY.txt'],
  ['openbible-ancient.jsonl', 'https://raw.githubusercontent.com/openbibleinfo/Bible-Geocoding-Data/main/data/ancient.jsonl'],
  ['openbible-source.jsonl', 'https://raw.githubusercontent.com/openbibleinfo/Bible-Geocoding-Data/main/data/source.jsonl'],
  ['openbible-merged.txt', 'https://www.openbible.info/geo/data/merged.txt'],
  ['openbible-geometry.jsonl', 'https://raw.githubusercontent.com/openbibleinfo/Bible-Geocoding-Data/main/data/geometry.jsonl'],
  ['macula-greek.tsv', 'https://raw.githubusercontent.com/Clear-Bible/macula-greek/main/Nestle1904/tsv/macula-greek-Nestle1904.tsv'],
  ['bsb.usfx.xml', 'https://raw.githubusercontent.com/seven1m/open-bibles/master/eng-bsb.usfx.xml'], // BSB paragraphing for the verse-passage popup
];

for (const [name, url] of FILES) {
  const dest = join(OUT, name);
  if (existsSync(dest) && !process.argv.includes('--force')) { console.log('skip (exists):', name); continue; }
  process.stdout.write(`fetching ${name} … `);
  const r = await fetch(url, { headers: UA });
  if (!r.ok) { console.log('FAILED', r.status); continue; }
  const buf = Buffer.from(await r.arrayBuffer());
  writeFileSync(dest, buf);
  console.log(`${Math.round(buf.length / 1024)} KB`);
}
console.log('done →', OUT, '(gitignored)');
