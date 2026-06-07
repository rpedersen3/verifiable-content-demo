/**
 * check-no-licensed-content.ts — the ADR-0033 R1 discipline, applied to this
 * example: never reference or embed a copyrighted translation. Ship only
 * public-domain editions (BSB / KJV / WEB / ASV). Scans apps/<app>/src/**.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname ?? __dirname, '..');
const ACRONYMS = /\b(NIV|ESV|NASB|NLT|NKJV|NRSV|HCSB|NIrV|TNIV|NABRE)\b/;
const FULL_NAMES = /new international version|english standard version|new american standard|new living translation|new king james|new revised standard|christian standard bible|amplified bible|holman christian standard/i;
const SKIP = new Set(['dist', 'node_modules', 'coverage', '.wrangler', '.next']);

function files(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    if (SKIP.has(e)) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.(ts|tsx|js|jsx|json)$/.test(e) && !e.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

const apps = join(ROOT, 'apps');
const findings: string[] = [];
if (existsSync(apps)) {
  for (const app of readdirSync(apps)) {
    const src = join(apps, app, 'src');
    if (!existsSync(src)) continue;
    for (const f of files(src)) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        const hit = ACRONYMS.exec(line) ?? FULL_NAMES.exec(line);
        if (hit) findings.push(`  ${f.replace(ROOT + '/', '')}:${i + 1}  [licensed edition: ${hit[0]}]`);
      });
    }
  }
}

if (findings.length > 0) {
  console.error('FAIL check:no-licensed-content — a copyrighted translation leaked into the demo (ADR-0033 R1):');
  console.error(findings.join('\n'));
  console.error('Ship public-domain editions only (BSB/KJV/WEB/ASV); rights holders publish their own signed descriptors.');
  process.exit(1);
}
console.log('OK check:no-licensed-content — no copyrighted translations in the demo.');
