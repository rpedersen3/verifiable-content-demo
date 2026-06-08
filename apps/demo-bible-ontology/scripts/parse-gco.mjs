// Parse the real Global Church Ontology (core.jsonld) and compute each term's
// PROV-O alignment by walking its rdfs:subClassOf chain into PROV-O / DOLCE-UL.
// Emits gco_term(curie,label,type,parent,prov_align,comment) for validation:
//   prov_align ∈ { prov:Agent, prov:Activity, prov:Entity,            ← aligns to PROV-O
//                  dns:<Situation|Description|Concept|Role|Quality>,  ← DnS construct (not A/A/E)
//                  unaligned }                                        ← no PROV-O/DUL ancestor

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
const OWL = 'http://www.w3.org/2002/07/owl#';
const esc = (s) => String(s ?? '').replace(/'/g, "''");

function curie(iri) {
  if (!iri || iri.startsWith('_:')) return null;
  if (iri.includes('/ns/prov#')) return 'prov:' + iri.split('#')[1];
  if (iri.includes('global.church')) return 'gc:' + iri.split('#')[1];
  if (/DUL\.owl#|\/dul\/|ontologydesignpatterns\.org\/ont\/dul|\/dolce/i.test(iri)) return 'dul:' + iri.split('#').pop();
  if (iri.includes('/ns/org#')) return 'org:' + iri.split('#')[1];
  if (iri.includes('w3.org/ns/ssn') || iri.includes('sosa')) return 'sosa:' + iri.split('#').pop();
  if (iri.includes('skos')) return 'skos:' + iri.split('#').pop();
  if (iri.includes('#')) return iri.split('#').pop();
  return iri.split('/').pop();
}
// DUL/PROV ancestor → PROV-O category (or DnS construct)
const PROV_AGENT = new Set(['prov:Agent', 'prov:Person', 'prov:Organization', 'prov:SoftwareAgent', 'dul:Agent', 'dul:SocialAgent', 'dul:Person', 'dul:Organization', 'dul:NaturalPerson']);
const PROV_ACT = new Set(['prov:Activity', 'dul:Event', 'dul:Action', 'dul:Process', 'dul:Task', 'dul:Activity']);
const PROV_ENT = new Set(['prov:Entity', 'dul:Object', 'dul:PhysicalObject', 'dul:Place', 'dul:InformationObject', 'dul:InformationEntity', 'dul:SocialObject', 'dul:DesignedArtifact']);
const DNS = new Set(['dul:Description', 'dul:Situation', 'dul:Concept', 'dul:Role', 'dul:Quality', 'dul:Parameter', 'dul:Collection', 'dul:Goal', 'dul:Plan', 'dul:Norm']);

function main() {
  const d = JSON.parse(readFileSync(join(ROOT, '.data', 'gco.jsonld'), 'utf8'));
  const byId = new Map();
  for (const n of d) if (n['@id']) byId.set(n['@id'], n);

  const label = (n) => {
    const l = n[RDFS + 'label'];
    return (Array.isArray(l) ? l[0]?.['@value'] : l?.['@value']) ?? curie(n['@id']) ?? '';
  };
  const comment = (n) => {
    const c = n[RDFS + 'comment'];
    return (Array.isArray(c) ? c[0]?.['@value'] : c?.['@value']) ?? '';
  };
  const parents = (n) => (n[RDFS + 'subClassOf'] ?? n[RDFS + 'subPropertyOf'] ?? []).map((p) => p['@id']).filter((x) => x && !x.startsWith('_:'));

  // resolve a class's PROV-O alignment by walking subClassOf upward
  function align(startIri) {
    const seen = new Set();
    let frontier = [startIri];
    while (frontier.length) {
      const next = [];
      for (const iri of frontier) {
        const c = curie(iri);
        if (PROV_AGENT.has(c)) return 'prov:Agent';
        if (PROV_ACT.has(c)) return 'prov:Activity';
        if (PROV_ENT.has(c)) return 'prov:Entity';
        if (DNS.has(c)) return c.replace('dul:', 'dns:');
        if (seen.has(iri)) continue;
        seen.add(iri);
        const node = byId.get(iri);
        if (node) for (const p of parents(node)) next.push(p);
      }
      frontier = next;
    }
    return 'unaligned';
  }

  const rows = [];
  for (const n of d) {
    const id = n['@id'];
    if (!id || id.startsWith('_:')) continue;
    const types = [].concat(n['@type'] ?? []);
    const isClass = types.some((t) => t === OWL + 'Class');
    const isProp = types.some((t) => /Property$/.test(t));
    if (!isClass && !isProp) continue;
    const cu = curie(id);
    if (!cu || !cu.startsWith('gc:')) continue; // only GCO's own terms
    const par = parents(n).map(curie).filter(Boolean);
    rows.push({ curie: cu, label: label(n), type: isClass ? 'class' : 'property', parent: par[0] ?? null, prov_align: isClass ? align(id) : '(property)', comment: comment(n).slice(0, 300) });
  }

  const sql = rows.map((r) => `INSERT OR REPLACE INTO gco_term(curie,label,type,parent,prov_align,comment) VALUES('${esc(r.curie)}','${esc(r.label)}','${r.type}',${r.parent ? `'${esc(r.parent)}'` : 'NULL'},'${esc(r.prov_align)}','${esc(r.comment)}');`);
  writeFileSync(join(ROOT, '.data', 'ontology', 'gco_terms.sql'), sql.join('\n') + '\n');

  const cls = rows.filter((r) => r.type === 'class');
  const tally = cls.reduce((a, r) => ((a[r.prov_align] = (a[r.prov_align] ?? 0) + 1), a), {});
  console.log('GCO terms:', rows.length, '(classes', cls.length, ', properties', rows.length - cls.length, ')');
  console.log('PROV-O alignment of GCO classes:', JSON.stringify(tally, null, 0));
}
main();
