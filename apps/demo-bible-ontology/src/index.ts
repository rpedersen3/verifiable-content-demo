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

app.get('/', (c) => c.html(UI));
app.get('/health', (c) => c.json({ ok: true, service: 'demo-bible-ontology' }));

// Overview — totals, PROV-O class counts, GCO→PROV-O alignment tally.
app.get('/api/overview', async (c) => {
  const [tot, prov, kinds, gco, layers, sig] = await Promise.all([
    rows<{ t: string; n: number }>(c.env.DB, "SELECT 'nodes' t,count(*) n FROM node UNION ALL SELECT 'edges',count(*) FROM edge UNION ALL SELECT 'verseLinks',count(*) FROM node_verse UNION ALL SELECT 'classes',count(*) FROM ontology_class UNION ALL SELECT 'gcoTerms',count(*) FROM gco_term"),
    rows<{ prov_class: string; n: number }>(c.env.DB, 'SELECT prov_class,count(*) n FROM node WHERE prov_class IS NOT NULL GROUP BY prov_class ORDER BY n DESC'),
    rows<{ kind: string; n: number }>(c.env.DB, 'SELECT kind,count(*) n FROM node GROUP BY kind ORDER BY n DESC'),
    rows<{ prov_align: string; n: number }>(c.env.DB, "SELECT prov_align,count(*) n FROM gco_term WHERE type='class' GROUP BY prov_align ORDER BY n DESC"),
    rows<{ layer: string; n: number }>(c.env.DB, 'SELECT layer,count(*) n FROM ontology_class GROUP BY layer'),
    rows<{ polarity: string; n: number }>(c.env.DB, 'SELECT polarity,count(*) n FROM signal GROUP BY polarity'),
  ]);
  return c.json({ ok: true, totals: Object.fromEntries(tot.map((r) => [r.t, r.n])), prov, kinds, gcoAlign: gco, layers, signals: sig });
});

// Search nodes by label.
app.get('/api/search', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  if (!q) return c.json({ ok: true, results: [] });
  const r = await rows(c.env.DB, 'SELECT id,label,kind,prov_class,gc_class FROM node WHERE label LIKE ? ORDER BY (SELECT count(*) FROM node_verse WHERE node_id=node.id) DESC LIMIT 40', `%${q}%`);
  return c.json({ ok: true, results: r });
});

// PROV-O class browser — most-attested instances first.
app.get('/api/prov/:cls', async (c) => {
  const cls = 'prov:' + c.req.param('cls');
  const r = await rows(c.env.DB, 'SELECT id,label,kind,gc_class,(SELECT count(*) FROM node_verse WHERE node_id=node.id) verses FROM node WHERE prov_class=? ORDER BY verses DESC LIMIT 60', cls);
  return c.json({ ok: true, provClass: cls, results: r });
});

// Node detail — every layer's class, out/in edges (typed), verse provenance.
app.get('/api/node/:id', async (c) => {
  const id = c.req.param('id');
  const node = await c.env.DB.prepare('SELECT * FROM node WHERE id=?').bind(id).first();
  if (!node) return c.json({ ok: false, error: 'not found' }, 404);
  const [out, inc, verses, signals] = await Promise.all([
    rows(c.env.DB, 'SELECT e.rel, e.dst id, n.label, n.kind FROM edge e JOIN node n ON n.id=e.dst WHERE e.src=? LIMIT 200', id),
    rows(c.env.DB, 'SELECT e.rel, e.src id, n.label, n.kind FROM edge e JOIN node n ON n.id=e.src WHERE e.dst=? LIMIT 200', id),
    rows<{ osis: string }>(c.env.DB, 'SELECT osis FROM node_verse WHERE node_id=? LIMIT 80', id),
    rows(c.env.DB, 'SELECT polarity, basis, osis FROM signal WHERE subject_id=?', id),
  ]);
  return c.json({ ok: true, node, out, in: inc, verses: verses.map((v) => v.osis), signals });
});

// Ego graph for the trust-graph viz: center + neighbors (typed edges).
app.get('/api/graph', async (c) => {
  const center = c.req.query('center');
  if (!center) return c.json({ ok: false, error: 'center required' }, 400);
  const out = await rows<{ rel: string; id: string; label: string; kind: string }>(c.env.DB, 'SELECT e.rel, e.dst id, n.label, n.kind FROM edge e JOIN node n ON n.id=e.dst WHERE e.src=? LIMIT 60', center);
  const inc = await rows<{ rel: string; id: string; label: string; kind: string }>(c.env.DB, 'SELECT e.rel, e.src id, n.label, n.kind FROM edge e JOIN node n ON n.id=e.src WHERE e.dst=? LIMIT 60', center);
  const self = await c.env.DB.prepare('SELECT id,label,kind FROM node WHERE id=?').bind(center).first<{ id: string; label: string; kind: string }>();
  const nodes = new Map<string, { id: string; label: string; kind: string }>();
  if (self) nodes.set(self.id, self);
  const edges: { from: string; rel: string; to: string }[] = [];
  for (const e of out) {
    nodes.set(e.id, { id: e.id, label: e.label, kind: e.kind });
    edges.push({ from: center, rel: e.rel, to: e.id });
  }
  for (const e of inc) {
    nodes.set(e.id, { id: e.id, label: e.label, kind: e.kind });
    edges.push({ from: e.id, rel: e.rel, to: center });
  }
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
