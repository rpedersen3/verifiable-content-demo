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
    const coord = coordByName.get(norm(name));
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

  return { sources, xrefs, nodeSources, forms, stats };
}

function stripMarkup(s) { return String(s ?? '').replace(/^#/, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 400); }
function mapOtherKind(type) {
  if (/Supernatural|God|demon|Sheol/i.test(type)) return 'deity';
  if (/Group|Nation/i.test(type)) return 'organization';
  return 'concept';
}
