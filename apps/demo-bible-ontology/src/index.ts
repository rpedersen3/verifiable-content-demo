// Bible ontology explorer API + SPA. A PROV-O graph (Agent/Activity/Entity) of the
// Bible — from the Theographic Bible Metadata (CC-BY-SA) — layered under DUL, W3C ORG,
// GeoSPARQL, aps: skills and gc: lower vocab, used to VALIDATE the Global Church
// Ontology against PROV-O and real Bible usage. Verse-linked throughout.
import { Hono } from 'hono';
import { UI } from './ui.js';

interface D1 {
  prepare(q: string): { bind(...a: unknown[]): { first<T = unknown>(): Promise<T | null>; all<T = unknown>(): Promise<{ results: T[] }> }; all<T = unknown>(): Promise<{ results: T[] }> };
}
type Env = { DB: D1 };
const app = new Hono<{ Bindings: Env }>();
const rows = <T,>(db: D1, q: string, ...b: unknown[]) => db.prepare(q).bind(...b).all<T>().then((r) => r.results);
// Transitive subclasses (+ self) of a class, from the precomputed closure — the heart of
// inheritance-aware queries: ask for prov:Agent, get gc:Person / gc:Nation / … too.
const subclassesOf = (db: D1, curie: string) => rows<{ class: string }>(db, 'SELECT class FROM class_closure WHERE ancestor=?', curie).then((r) => r.map((x) => x.class));
// A node is an instance of `curie` if ANY of its layer-classes is a subclass-or-self of it.
const LAYER_COLS = ['prov_class', 'dul_class', 'org_class', 'geo_class', 'gc_class', 'aps_class'];
const instanceWhere = (classes: string[]) => {
  const ph = classes.map(() => '?').join(',');
  return { sql: LAYER_COLS.map((col) => `${col} IN (${ph})`).join(' OR '), args: LAYER_COLS.flatMap(() => classes) };
};

app.get('/', (c) => c.html(UI));
app.get('/health', (c) => c.json({ ok: true, service: 'demo-bible-ontology' }));

// Overview — totals, PROV-O class counts, GCO→PROV-O alignment tally.
app.get('/api/overview', async (c) => {
  const [tot, prov, kinds, gco, layers, sig, scores, imgs, bands, origins, coverage, srcCov] = await Promise.all([
    rows<{ t: string; n: number }>(c.env.DB, "SELECT 'nodes' t,count(*) n FROM node UNION ALL SELECT 'edges',count(*) FROM edge UNION ALL SELECT 'verseLinks',count(*) FROM node_verse UNION ALL SELECT 'classes',count(*) FROM ontology_class UNION ALL SELECT 'gcoTerms',count(*) FROM gco_term"),
    rows<{ prov_class: string; n: number }>(c.env.DB, 'SELECT prov_class,count(*) n FROM node WHERE prov_class IS NOT NULL GROUP BY prov_class ORDER BY n DESC'),
    rows<{ kind: string; n: number }>(c.env.DB, 'SELECT kind,count(*) n FROM node GROUP BY kind ORDER BY n DESC'),
    rows<{ prov_align: string; n: number }>(c.env.DB, "SELECT prov_align,count(*) n FROM gco_term WHERE type='class' GROUP BY prov_align ORDER BY n DESC"),
    rows<{ layer: string; n: number }>(c.env.DB, 'SELECT layer,count(*) n FROM ontology_class GROUP BY layer'),
    rows<{ polarity: string; n: number }>(c.env.DB, 'SELECT polarity,count(*) n FROM signal GROUP BY polarity'),
    rows<{ dimension: string; n: number; avg: number }>(c.env.DB, 'SELECT dimension,count(*) n,round(avg(value),3) avg FROM score GROUP BY dimension'),
    rows<{ n: number }>(c.env.DB, 'SELECT count(*) n FROM node WHERE image_thumb IS NOT NULL'),
    rows<{ band: string; n: number }>(c.env.DB, "SELECT CASE WHEN canon_method='source' THEN 'native' WHEN canon_confidence>=0.9 THEN 'high' WHEN canon_confidence>=0.7 THEN 'medium' ELSE 'low' END band, count(*) n FROM node WHERE canon_id IS NOT NULL GROUP BY band"),
    rows<{ origin_source: string; n: number }>(c.env.DB, 'SELECT origin_source,count(*) n FROM node WHERE origin_source IS NOT NULL GROUP BY origin_source ORDER BY n DESC'),
    rows<{ t: string; n: number }>(c.env.DB, "SELECT 'xrefs' t,count(*) n FROM xref UNION ALL SELECT 'forms',count(*) FROM node_form UNION ALL SELECT 'attestations',count(*) FROM node_source UNION ALL SELECT 'sources',count(*) FROM source"),
    rows<{ source_id: string; abbrev: string; license: string; n: number }>(c.env.DB, 'SELECT ns.source_id, s.abbrev, s.license, count(*) n FROM node_source ns JOIN source s ON s.source_id=ns.source_id GROUP BY ns.source_id ORDER BY n DESC'),
  ]);
  const integrity = Object.fromEntries(bands.map((b) => [b.band, b.n]));
  // Demonstrate inheritance: how many instances answer "give me all agents" via the closure
  // vs. the naive exact-class match (which misses every subclass).
  const agentCls = await subclassesOf(c.env.DB, 'prov:Agent');
  const w = instanceWhere(agentCls.length ? agentCls : ['prov:Agent']);
  const agents = await c.env.DB.prepare(`SELECT count(*) n FROM node WHERE ${w.sql}`).bind(...w.args).first<{ n: number }>();
  const agentsNaive = await c.env.DB.prepare("SELECT count(*) n FROM node WHERE prov_class='prov:Agent'").bind().first<{ n: number }>();
  return c.json({ ok: true, totals: Object.fromEntries(tot.map((r) => [r.t, r.n])), prov, kinds, gcoAlign: gco, layers, signals: sig, scores, withImage: imgs[0]?.n ?? 0, integrity, origins, coverage: Object.fromEntries(coverage.map((r) => [r.t, r.n])), sourceCoverage: srcCov, inheritance: { class: 'prov:Agent', subclasses: agentCls.length, viaClosure: agents?.n ?? 0, naiveExact: agentsNaive?.n ?? 0 } });
});

// Search nodes by label.
app.get('/api/search', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  if (!q) return c.json({ ok: true, results: [] });
  const r = await rows(c.env.DB, 'SELECT id,canon_id,label,kind,disambig,prov_class,gc_class,canon_confidence,image_thumb FROM node WHERE label LIKE ? ORDER BY (SELECT count(*) FROM node_verse WHERE node_id=node.id) DESC LIMIT 40', `%${q}%`);
  return c.json({ ok: true, results: r });
});

// Inheritance-aware class browser — instances of a class AND all its subclasses, across every
// ontology layer. e.g. ?curie=prov:Agent returns persons + organizations; ?curie=dul:Object even more.
app.get('/api/class', async (c) => {
  const curie = (c.req.query('curie') ?? '').trim();
  if (!curie) return c.json({ ok: false, error: 'curie required' }, 400);
  const subs = await subclassesOf(c.env.DB, curie);
  if (!subs.length) return c.json({ ok: true, curie, subclasses: [], total: 0, results: [] });
  const w = instanceWhere(subs);
  const total = await c.env.DB.prepare(`SELECT count(*) n FROM node WHERE ${w.sql}`).bind(...w.args).first<{ n: number }>();
  const results = await rows(c.env.DB, `SELECT id,canon_id,label,kind,disambig,prov_class,gc_class,image_thumb,canon_confidence,(SELECT count(*) FROM node_verse WHERE node_id=node.id) verses FROM node WHERE ${w.sql} ORDER BY verses DESC LIMIT 60`, ...w.args);
  return c.json({ ok: true, curie, subclasses: subs, total: total?.n ?? 0, results });
});

// Source registry + per-source coverage (attribution / licenses).
app.get('/api/sources', async (c) => {
  const sources = await rows(c.env.DB, 'SELECT s.source_id, s.name, s.abbrev, s.url, s.license, s.attribution, (SELECT count(*) FROM node_source ns WHERE ns.source_id=s.source_id) attestations, (SELECT count(*) FROM xref x WHERE x.source_id=s.source_id) xrefs, (SELECT count(*) FROM node n WHERE n.origin_source=s.source_id) minted FROM source s');
  return c.json({ ok: true, sources });
});

// Data-integrity review — brought-in (non-native) canonical-id bindings, weakest first, so
// suspect matches stay visible for human review instead of masquerading as certain.
app.get('/api/integrity', async (c) => {
  const max = Math.min(1, Math.max(0, parseFloat(c.req.query('max') ?? '1') || 1));
  const results = await rows(c.env.DB, "SELECT id,canon_id,label,kind,disambig,canon_confidence,canon_method,canon_basis,wikidata,image_thumb FROM node WHERE canon_method <> 'source' AND canon_confidence <= ? ORDER BY canon_confidence ASC LIMIT 200", max);
  const bands = await rows<{ band: string; n: number }>(c.env.DB, "SELECT CASE WHEN canon_method='source' THEN 'native' WHEN canon_confidence>=0.9 THEN 'high' WHEN canon_confidence>=0.7 THEN 'medium' ELSE 'low' END band, count(*) n FROM node WHERE canon_id IS NOT NULL GROUP BY band");
  return c.json({ ok: true, bands: Object.fromEntries(bands.map((b) => [b.band, b.n])), results });
});

// PROV-O class browser (back-compat) — now inheritance-aware: prov:Agent picks up Person + Org.
app.get('/api/prov/:cls', async (c) => {
  const cls = 'prov:' + c.req.param('cls');
  const subs = await subclassesOf(c.env.DB, cls);
  const w = instanceWhere(subs.length ? subs : [cls]);
  const r = await rows(c.env.DB, `SELECT id,canon_id,label,kind,disambig,gc_class,image_thumb,canon_confidence,(SELECT count(*) FROM node_verse WHERE node_id=node.id) verses FROM node WHERE ${w.sql} ORDER BY verses DESC LIMIT 60`, ...w.args);
  return c.json({ ok: true, provClass: cls, subclasses: subs, results: r });
});

// Node detail — every layer's class, out/in edges (typed), verse provenance.
app.get('/api/node/:id', async (c) => {
  const id = c.req.param('id');
  const node = await c.env.DB.prepare('SELECT * FROM node WHERE id=?').bind(id).first();
  if (!node) return c.json({ ok: false, error: 'not found' }, 404);
  const [out, inc, verses, signals, scores, formsR, xrefsR, sourcesR] = await Promise.all([
    rows(c.env.DB, 'SELECT e.rel, e.dst id, n.label, n.kind FROM edge e JOIN node n ON n.id=e.dst WHERE e.src=? LIMIT 200', id),
    rows(c.env.DB, 'SELECT e.rel, e.src id, n.label, n.kind FROM edge e JOIN node n ON n.id=e.src WHERE e.dst=? LIMIT 200', id),
    rows<{ osis: string }>(c.env.DB, 'SELECT osis FROM node_verse WHERE node_id=? LIMIT 80', id),
    rows(c.env.DB, 'SELECT polarity, basis, osis FROM signal WHERE subject_id=?', id),
    rows(c.env.DB, 'SELECT dimension, value, basis, method FROM score WHERE subject_id=? ORDER BY dimension', id),
    rows(c.env.DB, 'SELECT lang, form, strongs FROM node_form WHERE node_id=?', id),
    rows(c.env.DB, 'SELECT scheme, value, uri, relation, match_confidence, source_id FROM xref WHERE node_id=? ORDER BY scheme', id),
    rows(c.env.DB, 'SELECT ns.source_id, s.name, s.abbrev, s.url, s.license, ns.src_ref, ns.confidence FROM node_source ns JOIN source s ON s.source_id=ns.source_id WHERE ns.node_id=? ORDER BY ns.confidence DESC', id),
  ]);
  return c.json({ ok: true, node, out, in: inc, verses: verses.map((v) => v.osis), signals, scores, forms: formsR, xrefs: xrefsR, sources: sourcesR });
});

// Ego graph for the trust-graph viz: center + neighbors (typed edges).
app.get('/api/graph', async (c) => {
  const center = c.req.query('center');
  if (!center) return c.json({ ok: false, error: 'center required' }, 400);
  type NRow = { rel: string; id: string; label: string; kind: string; tStart: number | null; tEnd: number | null; img: string | null };
  const out = await rows<NRow>(c.env.DB, 'SELECT e.rel, e.dst id, n.label, n.kind, n.t_start tStart, n.t_end tEnd, n.image_thumb img FROM edge e JOIN node n ON n.id=e.dst WHERE e.src=? LIMIT 250', center);
  const inc = await rows<NRow>(c.env.DB, 'SELECT e.rel, e.src id, n.label, n.kind, n.t_start tStart, n.t_end tEnd, n.image_thumb img FROM edge e JOIN node n ON n.id=e.src WHERE e.dst=? LIMIT 250', center);
  const self = await c.env.DB.prepare('SELECT id,label,kind,t_start tStart,t_end tEnd,image_thumb img FROM node WHERE id=?').bind(center).first<{ id: string; label: string; kind: string; tStart: number | null; tEnd: number | null; img: string | null }>();
  // trust-signal polarity per node (the signal table is tiny — load it all + map)
  const sigRows = await rows<{ subject_id: string; polarity: string }>(c.env.DB, 'SELECT subject_id,polarity FROM signal');
  const sigMap = new Map<string, Set<string>>();
  for (const s of sigRows) (sigMap.get(s.subject_id) ?? sigMap.set(s.subject_id, new Set()).get(s.subject_id)!).add(s.polarity);
  const sigOf = (id: string): string | null => {
    const p = sigMap.get(id);
    if (!p) return null;
    const pos = p.has('positive') || p.has('mixed'), neg = p.has('negative') || p.has('mixed');
    return pos && neg ? 'mixed' : pos ? 'positive' : neg ? 'negative' : null;
  };
  const nodes = new Map<string, Record<string, unknown>>();
  const put = (n: { id: string; label: string; kind: string; tStart: number | null; tEnd: number | null; img?: string | null }) => {
    if (!nodes.has(n.id)) nodes.set(n.id, { id: n.id, label: n.label, kind: n.kind, tStart: n.tStart, tEnd: n.tEnd, sig: sigOf(n.id), img: n.img ?? null });
  };
  if (self) put(self);
  const edges: { from: string; rel: string; to: string }[] = [];
  for (const e of out) { put(e); edges.push({ from: center, rel: e.rel, to: e.id }); }
  for (const e of inc) { put(e); edges.push({ from: e.id, rel: e.rel, to: center }); }
  return c.json({ ok: true, center, nodes: [...nodes.values()], edges });
});

// GCO validation — every GCO class by its PROV-O alignment + Bible-usage coverage.
app.get('/api/validate', async (c) => {
  const align = c.req.query('align');
  const terms = align
    ? await rows(c.env.DB, "SELECT curie,label,prov_align,parent,comment FROM gco_term WHERE type='class' AND prov_align=? ORDER BY curie", align)
    : await rows(c.env.DB, "SELECT curie,label,prov_align,parent,comment FROM gco_term WHERE type='class' ORDER BY prov_align,curie");
  const tally = await rows<{ prov_align: string; n: number }>(c.env.DB, "SELECT prov_align,count(*) n FROM gco_term WHERE type='class' GROUP BY prov_align ORDER BY n DESC");
  // Bible-usage coverage per PROV-O class (how many instances exercise it)
  const usage = await rows<{ prov_class: string; n: number }>(c.env.DB, 'SELECT prov_class,count(*) n FROM node WHERE prov_class IS NOT NULL GROUP BY prov_class');
  return c.json({ ok: true, tally, usage, terms });
});

// Ontology class hierarchy across layers.
app.get('/api/classes', async (c) => {
  const r = await rows(c.env.DB, 'SELECT curie,label,layer,parent FROM ontology_class ORDER BY layer,curie');
  return c.json({ ok: true, classes: r });
});

export default app;
