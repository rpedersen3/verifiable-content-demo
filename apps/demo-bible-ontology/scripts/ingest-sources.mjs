// Multi-source A-box ingestion (data integrity first). Reconciles external datasets onto the
// Theographic canonical backbone, recording per-record source/license, a match confidence + SKOS
// relation on every cross-reference, and original-language forms. Unmatched entities mint NEW
// canonical nodes (origin tagged). Raw dumps are fetched into .data/sources/ (gitignored) — see
// scripts/fetch-sources.mjs. Sources: STEPBible TIPNR (CC BY) + OpenBible Geocoding (CC BY).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SRC = {
  theographic: ['Theographic Bible Metadata', 'TBM', 'https://github.com/robertrouse/theographic-bible-metadata', 'CC BY-SA 4.0', '© robertrouse'],
  tipnr: ['STEPBible TIPNR — Translators Individualised Proper Names', 'TIPNR', 'https://github.com/STEPBible/STEPBible-Data', 'CC BY 4.0', '© STEPBible.org / Tyndale House Cambridge'],
  openbible: ['OpenBible.info Bible Geocoding', 'OpenBible', 'https://www.openbible.info/geo/', 'CC BY 4.0', '© OpenBible.info — geometry ODbL (OpenStreetMap)'],
  macula: ['MACULA Greek (Clear Bible) — syntax + semantic roles', 'MACULA', 'https://github.com/Clear-Bible/macula-greek', 'CC BY 4.0', '© Clear Bible / Biblica'],
  wikidata: ['Wikidata', 'WD', 'https://www.wikidata.org/', 'CC0', 'Wikidata contributors'],
  pleiades: ['Pleiades', 'Pleiades', 'https://pleiades.stoa.org/', 'CC BY 3.0', 'Pleiades contributors'],
  geonames: ['GeoNames', 'GeoNames', 'https://www.geonames.org/', 'CC BY 4.0', 'GeoNames'],
};
const URI = {
  wikidata: (v) => `https://www.wikidata.org/entity/${v}`,
  pleiades: (v) => `https://pleiades.stoa.org/places/${v}`,
  geonames: (v) => `https://www.geonames.org/${v}`,
  tipnr: (v) => `https://www.stepbible.org/?q=version=ESV&reference=${encodeURIComponent(String(v).split('@')[1] || '')}`,
  strongs: (v) => `https://www.stepbible.org/?q=strong=${v}`,
  openbible: (v) => `https://www.openbible.info/geo/${v}`,
};
const qidOf = (wd) => (wd ? String(wd).match(/Q\d+/)?.[0] ?? null : null);

export function ingestSources(ctx) {
  const { ROOT, byId, addNode, addEdge, linkVerses, peopleByKey, placeByLabel, slugify, norm } = ctx;
  const S = join(ROOT, '.data', 'sources');
  const sources = Object.entries(SRC).map(([id, [name, abbrev, url, license, attr]]) => ({ id, name, abbrev, url, license, attr }));
  const xrefs = [], nodeSources = [], forms = [];
  const stats = { tipnr: { matched: 0, new: 0, forms: 0 }, openbible: { matched: 0, new: 0, exact: 0 } };

  const dedupX = new Set();
  const addXref = (nodeId, scheme, value, relation, conf, method, sourceId) => {
    if (!value) return;
    const k = `${nodeId}|${scheme}|${value}`;
    if (dedupX.has(k)) return;
    dedupX.add(k);
    xrefs.push({ nodeId, scheme, value, uri: URI[scheme] ? URI[scheme](value) : null, relation, conf, method, sourceId });
  };
  const addNodeSource = (nodeId, sourceId, ref, label, conf) => nodeSources.push({ nodeId, sourceId, ref, label, conf });

  const pick = (arr) => { // most-attested among same-name candidates → {id, n, dom}
    if (!arr || !arr.length) return null;
    const m = new Map();
    for (const c of arr) m.set(c.id, Math.max(m.get(c.id) ?? -1, c.v));
    const s = [...m].map(([id, v]) => ({ id, v })).sort((a, b) => b.v - a.v);
    const total = s.reduce((t, c) => t + Math.max(c.v, 0), 0) || 1;
    return { id: s[0].id, n: s.length, dom: s[0].v / total };
  };
  // name-based reconciliation → {id, conf, method} or null
  const reconcile = (name, index) => {
    const p = pick(index.get(norm(name)));
    if (!p) return null;
    if (p.n === 1) return { id: p.id, conf: 0.9, method: 'name-unique' };
    const conf = Math.max(0.45, Math.min(0.88, 0.6 + (p.dom - 0.5) * 0.6));
    return { id: p.id, conf: +conf.toFixed(2), method: `name-collision(${p.n})` };
  };

  // ─── STEPBible TIPNR ──────────────────────────────────────────────────────
  const tipnrFile = join(S, 'tipnr.txt');
  if (existsSync(tipnrFile)) ingestTipnr(readFileSync(tipnrFile, 'utf8'));
  function ingestTipnr(txt) {
    const lines = txt.split(/\r?\n/);
    let section = null, rec = null;
    const flush = () => { if (rec) handleTipnr(rec, section); rec = null; };
    for (const line of lines) {
      const sep = line.match(/^\$=+\s*(PERSON|PLACE|OTHER)/i);
      if (sep) { flush(); section = sep[1].toUpperCase(); rec = { top: null, subs: [], short: null, summary: null }; continue; }
      if (!rec) continue;
      if (line.startsWith('@Short=')) rec.short = line.slice(7).trim();
      else if (line.startsWith('–') || line.startsWith('–')) rec.subs.push(line);
      else if (!line.startsWith('@') && line.trim() && rec.top == null) rec.top = line;
    }
    flush();
  }
  function handleTipnr(rec, section) {
    if (!rec.top) return;
    const cols = rec.top.split('\t');
    const c0 = cols[0] || '';
    const eq = c0.lastIndexOf('=');
    if (eq < 0) return;
    const uStrong = c0.slice(eq + 1).trim();
    const namePart = c0.slice(0, eq);
    const at = namePart.indexOf('@');
    const name = (at >= 0 ? namePart.slice(0, at) : namePart).trim();
    if (!name || !/^[HG]\d/.test(uStrong)) return;
    const type = (cols[8] || '').trim();
    const desc = rec.short || stripMarkup(cols[7] || '');
    // original-language forms from sub-records: col2 = dStrong«eStrong=form
    const recForms = [];
    const allStrongs = new Set();
    for (const sub of rec.subs) {
      const sc = sub.split('\t');
      const sig = (sc[0] || '').replace(/^[––]\s*/, '').trim();
      const formCell = sc[2] || '';
      const fEq = formCell.lastIndexOf('=');
      if (fEq > 0) {
        const strongs = formCell.slice(0, fEq).split('«')[0].trim(); // before «
        const form = formCell.slice(fEq + 1).trim();
        if (form && strongs) {
          const lang = /Greek/i.test(sig) || /^G/.test(strongs) ? 'grc' : /Aramaic/i.test(sig) ? 'arc' : 'hbo';
          recForms.push({ lang, form, strongs });
        }
      }
      if (sig === 'Total') for (const s of (sc[2] || '').split(',')) { const t = s.trim(); if (/^[HG]\d/.test(t)) allStrongs.add(t); }
    }
    allStrongs.add(uStrong);
    const isPlace = section === 'PLACE';
    const reIndex = isPlace ? placeByLabel : peopleByKey;
    const m = reconcile(name, reIndex);
    let nodeId;
    if (m) {
      nodeId = m.id; stats.tipnr.matched++;
      addNodeSource(nodeId, 'tipnr', `${name}@${uStrong}`, name, m.conf);
    } else {
      // mint a new canonical node from TIPNR (data-integrity: source-only, lower confidence)
      const kindMap = { PERSON: 'person', PLACE: 'place', OTHER: 'concept' };
      const kind = isPlace ? 'place' : section === 'OTHER' ? mapOtherKind(type) : 'person';
      const prov = kind === 'place' ? 'prov:Entity' : kind === 'person' ? 'prov:Person' : null;
      const dul = kind === 'place' ? 'dul:Place' : kind === 'person' ? 'dul:Person' : 'dul:Concept';
      const gc = kind === 'place' ? 'gc:Place' : kind === 'person' ? 'gc:Person' : null;
      nodeId = `tipnr:${uStrong}`;
      if (byId.has(nodeId)) return;
      addNode({ id: nodeId, canonId: `${slugify(name)}_${uStrong}`, label: name, kind, disambig: type || null, prov, dul, gc, aps: null,
        canonConf: 0.6, canonMethod: 'tipnr:source-only', canonBasis: `minted from STEPBible TIPNR ${uStrong} (no Theographic match)`, origin: 'tipnr', extra: { tipnrType: type } });
      addNodeSource(nodeId, 'tipnr', `${name}@${uStrong}`, name, 0.95);
      stats.tipnr.new++;
    }
    // forms + strongs xrefs + tipnr xref
    for (const f of recForms) { forms.push({ nodeId, ...f, sourceId: 'tipnr' }); stats.tipnr.forms++; }
    addXref(nodeId, 'tipnr', `${name}@${uStrong}`, 'skos:exactMatch', m ? m.conf : 0.95, m ? m.method : 'tipnr-native', 'tipnr');
    for (const s of allStrongs) addXref(nodeId, 'strongs', s, 'skos:relatedMatch', m ? m.conf : 0.95, 'tipnr-strongs', 'tipnr');
  }

  // ─── OpenBible Bible Geocoding ────────────────────────────────────────────
  // merged.txt → reliable lat/lon + modern comment, keyed by ESV name
  const coordByName = new Map();
  const mergedFile = join(S, 'openbible-merged.txt');
  if (existsSync(mergedFile)) {
    for (const line of readFileSync(mergedFile, 'utf8').split(/\r?\n/)) {
      if (!line || line.startsWith('#')) continue;
      const [esv, root, lat, lon, , comment] = line.split('\t');
      if (esv) coordByName.set(norm(esv), { lat: parseFloat(lat), lon: parseFloat(lon), modern: (comment || root || '').trim() });
    }
  }
  // geometry.jsonl → representative point for every OpenBible place (covers names not in merged.txt)
  const geomFile = join(S, 'openbible-geometry.jsonl');
  if (existsSync(geomFile)) {
    for (const line of readFileSync(geomFile, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue; let g; try { g = JSON.parse(line); } catch { continue; }
      const k = norm(g.name); if (!k || coordByName.has(k)) continue;
      const ll = g.suggested?.label_line; const pt = Array.isArray(ll) && ll.length ? ll[0] : null;
      if (pt) { const [lon, lat] = String(pt).split(',').map(parseFloat); if (isFinite(lat) && isFinite(lon)) coordByName.set(k, { lat, lon, modern: null }); }
    }
  }
  const ancientFile = join(S, 'openbible-ancient.jsonl');
  if (existsSync(ancientFile)) {
    for (const line of readFileSync(ancientFile, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      handleOpenBible(o);
    }
  }
  function handleOpenBible(o) {
    const name = o.friendly_id || o.url_slug;
    if (!name) return;
    const ld = o.linked_data || {};
    const wikidata = qidOf(ld.s7cc8b2?.id);
    const pleiades = ld.s2428ed?.id ? String(ld.s2428ed.id).match(/\d+/)?.[0] : null;
    const geonames = ld.sd62f5f?.id ? String(ld.sd62f5f.id).match(/\d+/)?.[0] : null;
    const tipnrId = ld.s3b25cf?.id || null;
    let coord = coordByName.get(norm(name));
    const ll = o.identifications?.[0]?.resolutions?.[0]?.lonlat; // inline "lon,lat" for this place
    if ((!coord || !isFinite(coord.lat)) && ll) { const [lon, lat] = String(ll).split(',').map(parseFloat); if (isFinite(lat) && isFinite(lon)) coord = { lat, lon, modern: coord?.modern ?? null }; }
    if (coord && isFinite(coord.lat)) coordByName.set(norm(name), coord); // share with same-named places from other sources
    const modern = o.identifications?.[0] ? stripMarkup(o.identifications[0].description || '') : (coord?.modern || null);

    // reconcile to an existing place node: prefer Wikidata-QID agreement (exactMatch), else name
    let nodeId = null, conf = 0, method = null, relation = 'skos:closeMatch';
    const cand = pick(placeByLabel.get(norm(name)));
    if (cand) {
      const existingQid = qidOf(byId.get(cand.id)?.wikidata);
      if (wikidata && existingQid && wikidata === existingQid) { nodeId = cand.id; conf = 0.98; method = 'wikidata-agree'; relation = 'skos:exactMatch'; stats.openbible.exact++; }
      else { nodeId = cand.id; conf = cand.n === 1 ? 0.9 : +Math.max(0.5, 0.6 + (cand.dom - 0.5) * 0.6).toFixed(2); method = cand.n === 1 ? 'name-unique' : `name-collision(${cand.n})`; }
      stats.openbible.matched++;
      addNodeSource(nodeId, 'openbible', o.id, name, conf);
    } else {
      nodeId = `openbible:${o.id}`;
      if (byId.has(nodeId)) return;
      const lat = coord?.lat, lon = coord?.lon;
      addNode({ id: nodeId, canonId: `${slugify(name)}_${o.id}`, label: name, kind: 'place', disambig: (o.types || []).join('/') || modern || null,
        prov: 'prov:Entity', dul: 'dul:Place', gc: 'gc:Place', aps: null, geoClass: 'geo:Feature',
        lat: isFinite(lat) ? lat : null, lon: isFinite(lon) ? lon : null, wkt: isFinite(lat) && isFinite(lon) ? `POINT(${lon} ${lat})` : null,
        canonConf: wikidata ? 0.75 : 0.6, canonMethod: 'openbible:source-only', canonBasis: `minted from OpenBible ${o.id} (no Theographic match)`, origin: 'openbible', extra: { obTypes: o.types, modern } });
      // verse links for the new place
      const osises = (o.verses || []).map((v) => v.osis).filter(Boolean).slice(0, 80);
      if (ctx.addVerseLinks) ctx.addVerseLinks(nodeId, osises);
      addNodeSource(nodeId, 'openbible', o.id, name, 0.95);
      conf = wikidata ? 0.8 : 0.6; method = 'openbible-native';
      stats.openbible.new++;
    }
    // refine coords on a matched node that lacks them
    if (coord && isFinite(coord.lat)) { const nd = byId.get(nodeId); if (nd && nd.lat == null) { nd.lat = coord.lat; nd.lon = coord.lon; nd.wkt = `POINT(${coord.lon} ${coord.lat})`; } }
    if (modern) { const nd = byId.get(nodeId); if (nd && nd.extra) nd.extra.modern = modern; }
    addXref(nodeId, 'openbible', o.id, 'skos:exactMatch', conf, method, 'openbible');
    if (wikidata) addXref(nodeId, 'wikidata', wikidata, relation, conf, method, 'openbible');
    if (pleiades) addXref(nodeId, 'pleiades', pleiades, 'skos:closeMatch', conf, 'openbible-linked', 'openbible');
    if (geonames) addXref(nodeId, 'geonames', geonames, 'skos:closeMatch', conf, 'openbible-linked', 'openbible');
    if (tipnrId) addXref(nodeId, 'tipnr', tipnrId, 'skos:closeMatch', conf, 'openbible-linked', 'openbible');
  }

  // geo-reference every remaining place by name from OpenBible's geometry, so all locatable biblical
  // places appear on the map. Truly-unidentified places stay unplaced — no fabricated coordinates.
  let geoFilled = 0;
  for (const [, n] of byId) {
    if (n.kind !== 'place' || n.lat != null) continue;
    const c = coordByName.get(norm(n.label));
    if (c && isFinite(c.lat)) { n.lat = c.lat; n.lon = c.lon; n.wkt = `POINT(${c.lon} ${c.lat})`; geoFilled++; }
  }
  stats.geoFilled = geoFilled;
  return { sources, xrefs, nodeSources, forms, stats };
}

// Curated fine-grained interactions (conversation level) — letters & speech acts with typed roles,
// each a prov:Activity with a canonical id + scripture ref. Built ONLY between endpoints that resolve
// to canonical nodes (data integrity); unresolved ones are logged, never silently dropped. This is the
// hand-curated, high-confidence seed of the model that MACULA semantic-role extraction will scale.
export function ingestInteractions(ctx) {
  const { ROOT, byId, addNode, addEdge, addVerseLinks, peopleByKey, placeByLabel, slugify, norm } = ctx;
  let data;
  try { data = JSON.parse(readFileSync(join(ROOT, 'apps', 'demo-bible-ontology', 'data', 'interactions.json'), 'utf8')); }
  catch { return { count: 0, edges: 0, skipped: 0 }; }
  const pickId = (name, index) => {
    const a = index.get(norm(name)); if (!a || !a.length) return null;
    const m = new Map(); for (const c of a) m.set(c.id, Math.max(m.get(c.id) ?? -1, c.v));
    return [...m].sort((x, y) => y[1] - x[1])[0][0];
  };
  const resolve = (name) => pickId(name, peopleByKey) || pickId(name, placeByLabel);
  const CLS = { correspondence: 'gc:Correspondence', speech: 'gc:SpeechAct', encounter: 'gc:Encounter' };
  let count = 0, edges = 0; const skipped = [];
  for (const it of data) {
    const author = resolve(it.author);
    if (!author) { skipped.push(`${it.id}(author:${it.author})`); continue; }
    const recs = (it.recipients ?? []).map((r) => ({ name: r, id: resolve(r) })).filter((r) => r.id);
    if (!recs.length) { skipped.push(`${it.id}(recipients)`); continue; }
    const gc = CLS[it.kind] ?? 'gc:Interaction';
    const id = `interaction:${it.id}`;
    addNode({ id, canonId: `interaction_${it.id}`, label: it.label, kind: 'interaction', disambig: gc.split(':')[1],
      prov: 'prov:Activity', dul: 'dul:Event', gc, aps: null,
      canonConf: 0.9, canonMethod: 'curated:scripture', canonBasis: `curated interaction from canonical scripture${it.osis ? ` (${it.osis})` : ''}`, origin: 'interaction', extra: { osis: it.osis, basis: it.basis } });
    if (it.osis) addVerseLinks(id, [it.osis]);
    const authorRel = it.kind === 'correspondence' ? 'gc:authoredBy' : 'gc:hasSpeaker';
    addEdge(id, authorRel, author);
    addEdge(id, 'prov:wasAssociatedWith', author);
    for (const r of recs) { addEdge(id, it.kind === 'correspondence' ? 'gc:addressedTo' : 'gc:hasAddressee', r.id); edges++; }
    count++;
  }
  if (skipped.length) console.log('interactions skipped (unresolved endpoints):', skipped.join(', '));
  return { count, edges, skipped: skipped.length };
}

// Curated planning/speech-act showcase (John 21) modeled with PROV-O + P-Plan + EP-Plan + DOLCE:
// a Plan (Description) that defines ordered Steps; questions / answers / requests as typed speech
// acts (illocutionary force); each Request prescribes a plan Step. Demonstrates planning · requests · doing.
const ACT_CLASS = { question: 'gc:Question', answer: 'gc:Answer', request: 'gc:Request', command: 'gc:Command', statement: 'gc:Statement', promise: 'gc:Promise', blessing: 'gc:Blessing' };
export function ingestPlans(ctx) {
  const { ROOT, byId, addNode, addEdge, addVerseLinks, peopleByKey, norm } = ctx;
  let data;
  try { data = JSON.parse(readFileSync(join(ROOT, 'apps', 'demo-bible-ontology', 'data', 'plans.json'), 'utf8')); }
  catch { return { plans: 0, steps: 0, acts: 0 }; }
  const resolve = (name) => { const a = peopleByKey.get(norm(name)); if (!a || !a.length) return null; const m = new Map(); for (const c of a) m.set(c.id, Math.max(m.get(c.id) ?? -1, c.v)); return [...m].sort((x, y) => y[1] - x[1])[0][0]; };
  let plans = 0, steps = 0, acts = 0;
  for (const p of data) {
    const agent = resolve(p.agent), beneficiary = resolve(p.beneficiary);
    if (!agent) continue;
    const planId = `plan:${p.id}`;
    addNode({ id: planId, canonId: `plan_${p.id}`, label: p.label, kind: 'plan', disambig: (p.type || 'pplan:Plan').split(':')[1], prov: 'prov:Plan', dul: 'dul:Description', gc: p.type || 'epplan:ExecutablePlan', aps: null, canonConf: 0.9, canonMethod: 'curated:scripture', canonBasis: `curated plan from canonical scripture (${p.osis})`, origin: 'plan', extra: { basis: p.basis, osis: p.osis } });
    if (p.osis) addVerseLinks(planId, [p.osis]);
    addEdge(planId, 'prov:wasAssociatedWith', agent);
    if (beneficiary) addEdge(planId, 'gc:addressedTo', beneficiary);
    plans++;
    // ordered executable steps
    const stepId = {}; let prev = null;
    for (const st of p.steps || []) {
      const sid = `step:${p.id}:${st.id}`; stepId[st.id] = sid;
      addNode({ id: sid, canonId: `step_${p.id}_${st.id}`, label: st.label, kind: 'step', disambig: 'ExecutableStep', prov: null, dul: 'dul:Concept', gc: 'epplan:ExecutableStep', aps: null, canonConf: 0.9, canonMethod: 'curated:scripture', canonBasis: `plan step (${st.osis || p.osis})`, origin: 'plan', extra: {} });
      if (st.osis) addVerseLinks(sid, [st.osis]);
      addEdge(sid, 'pplan:isStepOfPlan', planId);
      addEdge(planId, 'dul:defines', sid);            // Plan (Description) defines its Steps (Concepts)
      if (prev) addEdge(sid, 'pplan:isPrecededBy', prev);
      prev = sid; steps++;
    }
    // typed speech acts (questions / answers / requests), each linked to its speaker + addressee
    for (const ex of p.exchanges || []) {
      const sp = resolve(ex.speaker), ad = resolve(ex.addressee);
      if (!sp || !ad) continue;
      const gc = ACT_CLASS[ex.type] || 'gc:SpeechAct';
      const aid = `act:${p.id}:${ex.id}`;
      addNode({ id: aid, canonId: `act_${p.id}_${ex.id}`, label: ex.text, kind: 'speechact', disambig: gc.split(':')[1], prov: 'prov:Activity', dul: 'dul:Event', gc, aps: null, canonConf: 0.9, canonMethod: 'curated:scripture', canonBasis: `${gc.split(':')[1]} (${ex.osis})`, origin: 'plan', extra: { osis: ex.osis } });
      if (ex.osis) addVerseLinks(aid, [ex.osis]);
      addEdge(aid, 'gc:hasSpeaker', sp);
      addEdge(aid, 'gc:hasAddressee', ad);
      addEdge(aid, 'prov:wasAssociatedWith', sp);
      if (ex.step && stepId[ex.step]) addEdge(aid, 'gc:prescribes', stepId[ex.step]); // Request prescribes a plan Step
      acts++;
    }
  }
  return { plans, steps, acts };
}

// Spiritual generations — curated discipleship/mentorship chains + church plants, so the generational
// map shows movements (Paul disciples Timothy, plants the church at Ephesus, …) alongside biological
// descent. Built only between endpoints that resolve to canonical nodes.
export function ingestMovements(ctx) {
  const { ROOT, byId, addEdge, peopleByKey, placeByLabel, norm } = ctx;
  let data;
  try { data = JSON.parse(readFileSync(join(ROOT, 'apps', 'demo-bible-ontology', 'data', 'movements.json'), 'utf8')); }
  catch { return { discipled: 0, planted: 0 }; }
  const pick = (idx, name) => { const a = idx.get(norm(name)); if (!a || !a.length) return null; const m = new Map(); for (const c of a) m.set(c.id, Math.max(m.get(c.id) ?? -1, c.v)); return [...m].sort((x, y) => y[1] - x[1])[0][0]; };
  let discipled = 0, planted = 0;
  for (const d of data.discipled ?? []) {
    const mentor = pick(peopleByKey, d.mentor); if (!mentor) continue;
    for (const name of d.disciples ?? []) { const id = pick(peopleByKey, name); if (id && id !== mentor) { addEdge(mentor, 'gc:discipled', id); discipled++; } }
  }
  for (const p of data.planted ?? []) {
    const planter = pick(peopleByKey, p.planter); if (!planter) continue;
    for (const ch of p.churches ?? []) { const id = pick(placeByLabel, ch); if (id) { addEdge(planter, 'gc:planted', id); planted++; } }
  }
  return { discipled, planted };
}

// MACULA semantic-role extraction → conversation-level relationships AT SCALE.
// Identifies speech-act verbs (Louw-Nida domain 33 = Communication), resolves the SPEAKER (subjref)
// and ADDRESSEE (a dative participant, via the referent chain to a named antecedent), maps both to
// canonical person/organization nodes, and aggregates by canonical pair into weighted gc:spokeTo
// edges (count + sample refs). Places are excluded; only edges where BOTH endpoints resolve are
// emitted (data integrity). This scales the curated interaction model to the whole Greek NT.
export function ingestMacula(ctx) {
  const { ROOT, byId, addEdge, peopleByKey, norm } = ctx;
  const file = join(ROOT, '.data', 'sources', 'macula-greek.tsv');
  if (!existsSync(file)) { console.warn('no macula-greek.tsv — speech extraction skipped'); return { pairs: 0, edges: 0 }; }
  // resolver: name → canonical person (most-attested) or organization node id; never a place
  const groupByName = new Map();
  for (const [id, n] of byId) if (n.kind === 'organization') { const k = norm(n.label); (groupByName.get(k) ?? groupByName.set(k, []).get(k)).push(id); }
  const resolve = (name) => {
    if (!name) return null; const k = norm(name);
    const p = peopleByKey.get(k);
    if (p && p.length) { const m = new Map(); for (const c of p) m.set(c.id, Math.max(m.get(c.id) ?? -1, c.v)); return [...m].sort((a, b) => b[1] - a[1])[0][0]; }
    const g = groupByName.get(k); return g && g.length ? g[0] : null;
  };
  // parse the flat per-word TSV
  const lines = readFileSync(file, 'utf8').split('\n');
  const H = lines[0].split('\t'), ci = Object.fromEntries(H.map((h, i) => [h, i]));
  const W = new Map(), byVerse = new Map();
  const verseOf = (ref) => (ref || '').split('!')[0];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split('\t'); if (c.length < 27) continue;
    const w = { id: c[ci['xml:id']], ref: c[ci.ref], cls: c[ci.class], type: c[ci.type], cas: c[ci.case], lemma: c[ci.lemma], gloss: c[ci.gloss], ln: c[ci.ln], subjref: c[ci.subjref], referent: c[ci.referent] };
    if (!w.id) continue;
    W.set(w.id, w);
    const v = verseOf(w.ref); (byVerse.get(v) ?? byVerse.set(v, []).get(v)).push(w);
  }
  const clean = (g) => (g || '').replace(/^\s*(of|to|the|\[the\]|and|but|for|with|by|in)\s+/i, '').replace(/[^A-Za-z' -]/g, '').trim();
  const nameOf = (id, depth = 0) => {
    if (!id || depth > 7) return null;
    for (const part of id.split(' ')) { const w = W.get(part); if (!w) continue; if (w.type === 'proper') return clean(w.gloss); if (w.referent) { const n = nameOf(w.referent, depth + 1); if (n) return n; } }
    return null;
  };
  // classify illocutionary force from the Greek speech verb (lemma)
  const classifyAct = (lemma) => {
    if (/(ἐρωτάω|ἐπερωτάω|πυνθάνομαι)/.test(lemma)) return 'question';
    if (/(ἐντέλλομαι|κελεύω|παραγγέλλω|ἐπιτάσσω|διαστέλλομαι|προστάσσω|ἐμβριμάομαι)/.test(lemma)) return 'command';
    if (/(ἀποκρίνομαι)/.test(lemma)) return 'answer';
    if (/(παρακαλέω|δέομαι|αἰτέω)/.test(lemma)) return 'request';
    if (/(εὐλογέω|εὐχαριστέω)/.test(lemma)) return 'blessing';
    return 'statement';
  };
  const agg = new Map(); let pairs = 0;
  for (const [, w] of W) {
    if (w.cls !== 'verb' || !/^33/.test(w.ln)) continue;       // communication-domain verb
    const sId = resolve(nameOf(w.subjref)); if (!sId) continue; // speaker → canonical node
    const verse = byVerse.get(verseOf(w.ref)) || [];
    let aId = null;
    for (const x of verse) { if (x.cas !== 'dative') continue; const id = resolve(nameOf(x.referent || x.id)); if (id && id !== sId) { aId = id; break; } }
    if (!aId) continue;
    pairs++;
    const act = classifyAct(w.lemma);
    const key = `${sId}|${aId}`; const e = agg.get(key) ?? { n: 0, refs: [], acts: {} }; e.n++; e.acts[act] = (e.acts[act] ?? 0) + 1; if (e.refs.length < 5) e.refs.push(verseOf(w.ref)); agg.set(key, e);
  }
  for (const [key, e] of agg) { const [s, a] = key.split('|'); addEdge(s, 'gc:spokeTo', a, JSON.stringify({ n: e.n, acts: e.acts, refs: e.refs, source: 'macula' })); }
  return { pairs, edges: agg.size };
}

function stripMarkup(s) { return String(s ?? '').replace(/^#/, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 400); }
function mapOtherKind(type) {
  if (/Supernatural|God|demon|Sheol/i.test(type)) return 'deity';
  if (/Group|Nation/i.test(type)) return 'organization';
  return 'concept';
}
