// Bible ontology explorer API + SPA. A PROV-O graph (Agent/Activity/Entity) of the
// Bible — from the Theographic Bible Metadata (CC-BY-SA) — layered under DUL,
// GeoSPARQL, aps: skills and gc: lower vocab, used to VALIDATE the Global Church
// Ontology against PROV-O and real Bible usage. Verse-linked throughout.
import { Hono } from 'hono';
import { UI } from './ui.js';

interface D1 {
  prepare(q: string): { bind(...a: unknown[]): { first<T = unknown>(): Promise<T | null>; all<T = unknown>(): Promise<{ results: T[] }>; run(): Promise<unknown> }; all<T = unknown>(): Promise<{ results: T[] }> };
}
type Env = { DB: D1; ANTHROPIC_API_KEY?: string; ANALYZE_MODEL?: string };
const app = new Hono<{ Bindings: Env }>();
const rows = <T,>(db: D1, q: string, ...b: unknown[]) => db.prepare(q).bind(...b).all<T>().then((r) => r.results);
// Transitive subclasses (+ self) of a class, from the precomputed closure — the heart of
// inheritance-aware queries: ask for prov:Agent, get gc:Person / gc:Nation / … too.
const subclassesOf = (db: D1, curie: string) => rows<{ class: string }>(db, 'SELECT class FROM class_closure WHERE ancestor=?', curie).then((r) => r.map((x) => x.class));
// A node is an instance of `curie` if ANY of its layer-classes is a subclass-or-self of it.
const LAYER_COLS = ['prov_class', 'dul_class', 'org_class', 'geo_class', 'gc_class', 'aps_class'];
// Inline the class curies (controlled vocabulary from class_closure — no user input) to avoid
// D1's 100-bound-parameter limit when a class has many subclasses.
const instanceWhere = (classes: string[]) => {
  const inlist = classes.map((c) => `'${String(c).replace(/'/g, "''")}'`).join(',') || "''";
  return { sql: LAYER_COLS.map((col) => `${col} IN (${inlist})`).join(' OR '), args: [] as unknown[] };
};

app.get('/', (c) => { c.header('Cache-Control', 'no-cache, must-revalidate'); return c.html(UI); });
// Illustrative place images (/img/*.jpg) are served as static assets from ./public (see wrangler.toml).
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

// Search nodes by name OR alias ("also known as": Peter finds the node labelled Simon), with an
// optional kind filter (person / organization / activity / place / …).
const KIND_GROUPS: Record<string, string[]> = {
  person: ['person'], organization: ['organization'], place: ['place'], deity: ['deity'],
  activity: ['event', 'interaction', 'speechact', 'plan'], concept: ['concept', 'role', 'skill', 'responsibility'],
};
app.get('/api/search', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  const kind = (c.req.query('kind') ?? '').trim();
  const group = KIND_GROUPS[kind];
  const sort = (c.req.query('sort') ?? '').trim();
  const trust = (c.req.query('trust') ?? '').trim();
  const book = (c.req.query('book') ?? '').trim().replace(/[^A-Za-z0-9]/g, '');
  if (!q && !group && !trust && !book) return c.json({ ok: true, results: [] });
  const MORAL = "(SELECT value FROM score WHERE subject_id=node.id AND dimension='moral')";
  const NSIG = "(SELECT count(*) FROM signal WHERE subject_id=node.id)";
  const where: string[] = []; const args: unknown[] = [];
  if (q) { where.push('(label LIKE ? OR aka LIKE ?)'); args.push(`%${q}%`, `%${q.toLowerCase()}%`); }
  if (group) { where.push(`kind IN (${group.map(() => '?').join(',')})`); args.push(...group); }
  if (book) { where.push('id IN (SELECT node_id FROM node_verse WHERE osis LIKE ?)'); args.push(`${book}.%`); }
  const sub = (c.req.query('sub') ?? '').trim();
  const subdim = (c.req.query('subdim') ?? '').trim();
  if (sub) {
    if (subdim === 'role') { where.push("id IN (SELECT e.src FROM edge e JOIN node r ON r.id=e.dst WHERE e.rel IN('gc:holdsRole','gc:membershipRole') AND r.label=?)"); args.push(sub); }
    else if (subdim === 'ftype') { where.push("json_extract(meta,'$.featureType')=?"); args.push(sub); }
    else { where.push('gc_class=?'); args.push(sub); }
  }
  if (trust === 'pos') where.push(`${MORAL} > 0.2`);
  else if (trust === 'neg') where.push(`${MORAL} < -0.2`);
  else if (trust === 'signals') where.push(`${NSIG} > 0`);
  const verseOrd = '(SELECT count(*) FROM node_verse WHERE node_id=node.id) DESC';
  const DIMS = ['wisdom', 'faithfulness', 'courage', 'truthfulness', 'repentance'];
  let order = verseOrd, dimSel = '';
  if (sort === 'good' || sort === 'evil') { where.push(`${MORAL} IS NOT NULL`); order = `${MORAL} ${sort === 'evil' ? 'ASC' : 'DESC'}, ${verseOrd}`; }
  else if (DIMS.includes(sort)) { const d = `(SELECT value FROM score WHERE subject_id=node.id AND dimension='${sort}')`; where.push(`${d} IS NOT NULL`); order = `${d} DESC, ${verseOrd}`; dimSel = `,${d} dimval`; }
  else if (sort === 'signals') order = `${NSIG} DESC, ${verseOrd}`;
  const page = Math.max(0, parseInt(c.req.query('page') ?? '0', 10) || 0);
  const PER = 50, off = page * PER;
  const r = await rows(c.env.DB, `SELECT id,canon_id,label,kind,disambig,aka,prov_class,gc_class,canon_confidence,image_thumb,${MORAL} moral,${NSIG} nsig${dimSel} FROM node WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ${PER + 1} OFFSET ${off}`, ...args);
  const more = r.length > PER;
  return c.json({ ok: true, results: r.slice(0, PER), page, more });
});

// Second-level subtypes for a kind (drill-down): people → roles, places → feature type,
// everything else → gc_class. Each {val, label, n}; the matching `subdim` is returned.
app.get('/api/subtypes', async (c) => {
  const kind = (c.req.query('kind') ?? '').trim();
  const group = KIND_GROUPS[kind];
  if (!group) return c.json({ ok: true, dim: '', subs: [] });
  if (kind === 'person') {
    const subs = await rows(c.env.DB, "SELECT r.label val, r.label label, count(DISTINCT e.src) n FROM edge e JOIN node r ON r.id=e.dst JOIN node p ON p.id=e.src WHERE e.rel IN('gc:holdsRole','gc:membershipRole') AND p.kind='person' GROUP BY r.label ORDER BY n DESC LIMIT 24");
    return c.json({ ok: true, dim: 'role', subs });
  }
  if (kind === 'place') {
    const subs = await rows(c.env.DB, "SELECT json_extract(meta,'$.featureType') val, json_extract(meta,'$.featureType') label, count(*) n FROM node WHERE kind='place' AND json_extract(meta,'$.featureType') IS NOT NULL GROUP BY 1 ORDER BY n DESC LIMIT 24");
    return c.json({ ok: true, dim: 'ftype', subs });
  }
  const inK = group.map(() => '?').join(',');
  const subs = await rows(c.env.DB, `SELECT gc_class val, gc_class label, count(*) n FROM node WHERE kind IN (${inK}) AND gc_class IS NOT NULL GROUP BY gc_class ORDER BY n DESC LIMIT 24`, ...group);
  return c.json({ ok: true, dim: 'class', subs });
});

// Per-kind entity counts for a book (book→verse→entity) — drives the counts on the kind chips.
app.get('/api/bookfacets', async (c) => {
  const book = (c.req.query('book') ?? '').trim().replace(/[^A-Za-z0-9]/g, '');
  if (!book) return c.json({ ok: true, facets: {} });
  const rk = await rows<{ kind: string; n: number }>(c.env.DB, 'SELECT kind, count(*) n FROM node WHERE id IN (SELECT node_id FROM node_verse WHERE osis LIKE ?) GROUP BY kind', `${book}.%`);
  const map: Record<string, string> = { person: 'person', organization: 'organization', place: 'place', deity: 'deity', event: 'activity', interaction: 'activity', speechact: 'activity', plan: 'activity', role: 'concept', concept: 'concept', skill: 'concept', responsibility: 'concept' };
  const f: Record<string, number> = { '': 0, person: 0, organization: 0, activity: 0, place: 0, deity: 0, concept: 0 };
  for (const r of rk) { const g = map[r.kind]; if (g) { f[g] = (f[g] ?? 0) + r.n; f[''] = (f[''] ?? 0) + r.n; } }
  return c.json({ ok: true, facets: f });
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
  const book = (c.req.query('book') ?? '').trim().replace(/[^A-Za-z0-9]/g, '');
  const vord = book ? `ORDER BY (CASE WHEN osis LIKE '${book}.%' THEN 0 ELSE 1 END)` : '';
  const [out, inc, verses, vc, inBook, signals, scores, formsR, xrefsR, sourcesR] = await Promise.all([
    rows(c.env.DB, "SELECT e.rel, e.dst id, n.label, n.kind, e.ctx FROM edge e JOIN node n ON n.id=e.dst WHERE e.src=? AND n.kind!='membership' LIMIT 250", id),
    rows(c.env.DB, "SELECT e.rel, e.src id, n.label, n.kind, e.ctx FROM edge e JOIN node n ON n.id=e.src WHERE e.dst=? AND n.kind!='membership' LIMIT 250", id),
    rows<{ osis: string }>(c.env.DB, `SELECT osis FROM node_verse WHERE node_id=? ${vord} LIMIT 80`, id),
    c.env.DB.prepare('SELECT count(*) n FROM node_verse WHERE node_id=?').bind(id).first<{ n: number }>(),
    book ? c.env.DB.prepare(`SELECT count(*) n FROM node_verse WHERE node_id=? AND osis LIKE '${book}.%'`).bind(id).first<{ n: number }>() : Promise.resolve(null),
    rows(c.env.DB, 'SELECT polarity, basis, osis FROM signal WHERE subject_id=?', id),
    rows(c.env.DB, 'SELECT dimension, value, basis, method FROM score WHERE subject_id=? ORDER BY dimension', id),
    rows(c.env.DB, 'SELECT lang, form, strongs FROM node_form WHERE node_id=?', id),
    rows(c.env.DB, 'SELECT scheme, value, uri, relation, match_confidence, source_id FROM xref WHERE node_id=? ORDER BY scheme', id),
    rows(c.env.DB, 'SELECT ns.source_id, s.name, s.abbrev, s.url, s.license, ns.src_ref, ns.confidence FROM node_source ns JOIN source s ON s.source_id=ns.source_id WHERE ns.node_id=? ORDER BY ns.confidence DESC', id),
  ]);
  // Full inheritance chain from the node's most-specific class up to the root (root → leaf),
  // so an org shows prov:Organization → gc:Nation
  // instead of a flat set of facets.
  const nd = node as Record<string, unknown>;
  const leaf = (nd.gc_class || nd.aps_class || nd.org_class || nd.geo_class || nd.dul_class || nd.prov_class) as string | null;
  const classChain: { curie: string; label: string }[] = [];
  if (leaf) {
    type OC = { curie: string; label: string; parent: string | null };
    const cls = await rows<OC>(c.env.DB, 'SELECT curie,label,parent FROM ontology_class');
    const by: Record<string, OC> = {};
    for (const x of cls) by[x.curie] = x;
    let cur: string | null = leaf, guard = 0; const seen = new Set<string>();
    while (cur && guard++ < 24 && !seen.has(cur)) { seen.add(cur); const cc: OC | undefined = by[cur]; if (!cc) { classChain.unshift({ curie: cur, label: cur }); break; } classChain.unshift({ curie: cur, label: cc.label }); cur = cc.parent; }
  }
  return c.json({ ok: true, node, out, in: inc, verses: verses.map((v) => v.osis), verseCount: vc?.n ?? verses.length, inBookCount: inBook?.n ?? 0, classChain, signals, scores, forms: formsR, xrefs: xrefsR, sources: sourcesR });
});

// Ego graph for the trust-graph viz: center + neighbors (typed edges).
app.get('/api/graph', async (c) => {
  const center = c.req.query('center');
  if (!center) return c.json({ ok: false, error: 'center required' }, 400);
  type NRow = { rel: string; id: string; label: string; kind: string; tStart: number | null; tEnd: number | null; img: string | null };
  // Exclude reified membership nodes (an implementation detail — the direct
  // person→gc:memberOf edge already conveys membership) and the giant genealogy container.
  const HIDE = "n.kind!='membership' AND COALESCE(n.gc_class,'')!='gc:Genealogy'";
  const out = await rows<NRow>(c.env.DB, `SELECT e.rel, e.dst id, n.label, n.kind, n.t_start tStart, n.t_end tEnd, n.image_thumb img FROM edge e JOIN node n ON n.id=e.dst WHERE e.src=? AND ${HIDE} LIMIT 250`, center);
  const inc = await rows<NRow>(c.env.DB, `SELECT e.rel, e.src id, n.label, n.kind, n.t_start tStart, n.t_end tEnd, n.image_thumb img FROM edge e JOIN node n ON n.id=e.src WHERE e.dst=? AND ${HIDE} LIMIT 250`, center);
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

// Verse passage — the clicked verse plus its surrounding logically-grouped verses (BSB paragraph),
// guaranteed a readable minimum window, clamped to the book. Returns verse text to read in a popup.
app.get('/api/passage', async (c) => {
  const osis = (c.req.query('osis') ?? '').trim();
  if (!osis) return c.json({ ok: false, error: 'osis required' }, 400);
  const ed = 'bsb';
  const v = await c.env.DB.prepare('SELECT leaf_index AS li, osis FROM verses WHERE edition=? AND osis=?').bind(ed, osis).first<{ li: number; osis: string }>();
  if (!v) return c.json({ ok: false, error: 'verse not found', osis }, 404);
  const book = osis.split('.')[0];
  const bk = await c.env.DB.prepare("SELECT min(leaf_index) lo, max(leaf_index) hi FROM verses WHERE edition=? AND osis LIKE ?").bind(ed, book + '.%').first<{ lo: number; hi: number }>();
  const ps = await c.env.DB.prepare('SELECT max(start_idx) s FROM paragraph WHERE start_idx<=?').bind(v.li).first<{ s: number | null }>();
  const pe = await c.env.DB.prepare('SELECT min(start_idx) e FROM paragraph WHERE start_idx>?').bind(v.li).first<{ e: number | null }>();
  let start = ps?.s ?? v.li;
  let end = pe?.e != null ? pe.e - 1 : (bk?.hi ?? v.li);
  if (end - start + 1 < 6) { start = Math.min(start, v.li - 3); end = Math.max(end, v.li + 3); } // ensure readable context
  start = Math.max(start, bk?.lo ?? start); end = Math.min(end, bk?.hi ?? end);                 // stay within the book
  if (end - start + 1 > 14) { start = Math.max(bk?.lo ?? 0, v.li - 7); end = Math.min(bk?.hi ?? end, v.li + 6); }
  const verses = await rows<{ osis: string; text: string }>(c.env.DB, 'SELECT osis, text FROM verses WHERE edition=? AND leaf_index BETWEEN ? AND ? ORDER BY leaf_index', ed, start, end);
  return c.json({ ok: true, osis, edition: ed, verses });
});

// Generational lineage — descendants of a root person by generation (BFS over gc:hasChild).
app.get('/api/lineage', async (c) => {
  const root = c.req.query('root');
  if (!root) return c.json({ ok: false, error: 'root required' }, 400);
  const maxDepth = Math.min(7, Math.max(1, parseInt(c.req.query('depth') ?? '5', 10)));
  const rootNode = await c.env.DB.prepare('SELECT id,canon_id,label,kind,image_thumb,t_start tStart,t_end tEnd FROM node WHERE id=?').bind(root).first();
  if (!rootNode) return c.json({ ok: false, error: 'not found' }, 404);
  const relsAllowed = new Set(['gc:hasChild', 'gc:discipled', 'gc:planted', 'gc:gaveRiseTo', 'gc:hasSubOrganization', 'gc:grewOutOf']);
  const rels = (c.req.query('rels') ?? 'gc:hasChild').split(',').map((s) => s.trim()).filter((r) => relsAllowed.has(r));
  const relList = rels.length ? rels : ['gc:hasChild'];
  const visited = new Set([root]); let frontier = [root]; const levels = [[rootNode]]; const edges: { from: string; to: string }[] = [];
  let total = 1;
  for (let depth = 0; depth < maxDepth && frontier.length && total < 180; depth++) {
    const ph = frontier.map(() => '?').join(',');
    const rph = relList.map(() => '?').join(',');
    const kids = await rows<{ parent: string; id: string; label: string; kind: string; canon_id: string; image_thumb: string | null; tStart: number | null; tEnd: number | null }>(c.env.DB, `SELECT e.src parent, n.id, n.canon_id, n.label, n.kind, n.image_thumb, n.t_start tStart, n.t_end tEnd FROM edge e JOIN node n ON n.id=e.dst WHERE e.rel IN (${rph}) AND e.src IN (${ph}) ORDER BY (SELECT count(*) FROM node_verse WHERE node_id=n.id) DESC`, ...relList, ...frontier);
    const levelNodes = []; const next = [];
    for (const k of kids) { edges.push({ from: k.parent, to: k.id }); if (visited.has(k.id) || total >= 180) continue; visited.add(k.id); total++; levelNodes.push(k); next.push(k.id); }
    if (!levelNodes.length) break;
    levels.push(levelNodes); frontier = next;
  }
  return c.json({ ok: true, root, levels, edges, total });
});

// Organizations — "what grew out of what": each org's founder + parent org + member count.
app.get('/api/orgs', async (c) => {
  const orgs = await rows(c.env.DB, `SELECT o.id,o.canon_id,o.label,o.gc_class,
    (SELECT e.dst FROM edge e WHERE e.src=o.id AND e.rel='gc:grewOutOf' LIMIT 1) founderId,
    (SELECT n.label FROM edge e JOIN node n ON n.id=e.dst WHERE e.src=o.id AND e.rel='gc:grewOutOf' LIMIT 1) founder,
    (SELECT e.dst FROM edge e WHERE e.src=o.id AND e.rel='gc:subOrganizationOf' LIMIT 1) parentId,
    (SELECT n.label FROM edge e JOIN node n ON n.id=e.dst WHERE e.src=o.id AND e.rel='gc:subOrganizationOf' LIMIT 1) parentOrg,
    (SELECT count(*) FROM edge e WHERE e.dst=o.id AND e.rel='gc:memberOf') members
    FROM node o WHERE o.kind='organization' ORDER BY members DESC`);
  return c.json({ ok: true, orgs });
});

// Geospatial — places (real coordinates), activities geolocated to their Theographic location,
// and people at their birthplace (with lifespan for time animation). Only honest, edge-backed
// locations are returned — no fabricated coordinates.
app.get('/api/geo', async (c) => {
  const book = (c.req.query('book') ?? '').trim().replace(/[^A-Za-z0-9]/g, '');
  const refsOrd = book ? `ORDER BY (CASE WHEN osis LIKE '${book}.%' THEN 0 ELSE 1 END)` : '';
  const refs = (col: string) => `(SELECT group_concat(osis,'|') FROM (SELECT osis FROM node_verse WHERE node_id=${col} ${refsOrd} LIMIT 6)) refs`;
  const inBook = (col: string) => (book ? ` AND ${col} IN (SELECT node_id FROM node_verse WHERE osis LIKE '${book}.%')` : '');
  const [places, events, people] = await Promise.all([
    rows(c.env.DB, `SELECT id,canon_id,label,lat,long lon,disambig,image_thumb img,image_url imgFull,(SELECT polarity FROM signal WHERE subject_id=node.id LIMIT 1) sig,(SELECT count(*) FROM node_verse WHERE node_id=node.id) v,${refs('node.id')},CASE WHEN json_extract(meta,'$.featureType')='Region' OR json_extract(meta,'$.obTypes') LIKE '%region%' THEN 1 ELSE 0 END region FROM node WHERE kind='place' AND lat IS NOT NULL AND long IS NOT NULL${inBook('node.id')}`),
    rows(c.env.DB, `SELECT e.id,e.canon_id,e.label,e.t_start tStart,p.lat,p.long lon,p.label place,(SELECT polarity FROM signal WHERE subject_id=e.id LIMIT 1) sig,(SELECT count(*) FROM node_verse WHERE node_id=e.id) v,${refs('e.id')} FROM node e JOIN edge ed ON ed.src=e.id AND ed.rel='dul:hasLocation' JOIN node p ON p.id=ed.dst WHERE e.kind='event' AND p.lat IS NOT NULL${inBook('e.id')}`),
    rows(c.env.DB, `SELECT pe.id,pe.canon_id,pe.label,pe.t_start tStart,pe.t_end tEnd,pl.lat,pl.long lon,pl.label place,(SELECT polarity FROM signal WHERE subject_id=pe.id LIMIT 1) sig,(SELECT count(*) FROM node_verse WHERE node_id=pe.id) v,${refs('pe.id')} FROM node pe JOIN edge ed ON ed.src=pe.id AND ed.rel='gc:bornAt' JOIN node pl ON pl.id=ed.dst WHERE pe.kind='person' AND pl.lat IS NOT NULL${inBook('pe.id')}`),
  ]);
  return c.json({ ok: true, places, events, people });
});

// Timeline — dated people (lifespan bars) + events (points) within a year range. People overlap
// the window if their [birth,death] intersects it; events if their start year is inside it. Both are
// ranked by verse attestation and capped, with totals reported (no silent truncation).
app.get('/api/timeline', async (c) => {
  const from = parseInt(c.req.query('from') ?? '-4200', 10);
  const to = parseInt(c.req.query('to') ?? '120', 10);
  const evCap = Math.min(300, Math.max(20, parseInt(c.req.query('events') ?? '150', 10)));
  const book = (c.req.query('book') ?? '').trim().replace(/[^A-Za-z0-9]/g, '');
  const inBook = book ? ` AND id IN (SELECT node_id FROM node_verse WHERE osis LIKE '${book}.%')` : '';
  const sel = "id,canon_id,label,kind,disambig,t_start tStart,t_end tEnd,image_thumb,json_extract(meta,'$.dateBasis') basis,(SELECT polarity FROM signal WHERE subject_id=node.id LIMIT 1) sig,(SELECT count(*) FROM node_verse WHERE node_id=node.id) v";
  const [people, events, evTot, pplTot] = await Promise.all([
    rows(c.env.DB, `SELECT ${sel} FROM node WHERE kind='person' AND t_start IS NOT NULL AND t_start<=? AND COALESCE(t_end,t_start)>=?${inBook} ORDER BY v DESC LIMIT 130`, to, from),
    rows(c.env.DB, `SELECT ${sel} FROM node WHERE kind='event' AND t_start IS NOT NULL AND t_start<=? AND t_start>=?${inBook} ORDER BY v DESC LIMIT ?`, to, from, evCap),
    c.env.DB.prepare(`SELECT count(*) n FROM node WHERE kind='event' AND t_start IS NOT NULL AND t_start<=? AND t_start>=?${inBook}`).bind(to, from).first<{ n: number }>(),
    c.env.DB.prepare(`SELECT count(*) n FROM node WHERE kind='person' AND t_start IS NOT NULL AND t_start<=? AND COALESCE(t_end,t_start)>=?${inBook}`).bind(to, from).first<{ n: number }>(),
  ]);
  return c.json({ ok: true, from, to, people, events, eventTotal: evTot?.n ?? 0, peopleTotal: pplTot?.n ?? 0 });
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

// ── Signal Court: challenge a trust signal (AI agent review) + public feedback ──
// Public feedback thread for a given signal (keyed by subject + the signal's basis text).
app.get('/api/feedback', async (c) => {
  const subject = (c.req.query('subject') ?? '').trim();
  const basis = (c.req.query('basis') ?? '').trim();
  if (!subject) return c.json({ ok: true, feedback: [] });
  const where = basis ? 'subject_id=? AND basis=?' : 'subject_id=?';
  const args = basis ? [subject, basis] : [subject];
  const fb = await rows(c.env.DB, `SELECT id,subject_label,sig_kind,osis,stance,verdict,suggested,proposed_action,comment,author,author_sub,(assertion IS NOT NULL) signed,created_at FROM signal_feedback WHERE ${where} ORDER BY id DESC LIMIT 100`, ...args);
  return c.json({ ok: true, feedback: fb });
});

app.post('/api/feedback', async (c) => {
  const b = await c.req.json().catch(() => ({})) as Record<string, string>;
  const subject = String(b.subject_id ?? '').trim();
  const comment = String(b.comment ?? '').trim();
  const stance = ['agree', 'challenge', 'note'].includes(String(b.stance)) ? String(b.stance) : 'note';
  if (!subject || !comment) return c.json({ ok: false, error: 'subject and comment required' }, 400);
  const author = String(b.author ?? '').trim().slice(0, 80) || 'anonymous';
  const now = new Date().toISOString();
  await c.env.DB.prepare('INSERT INTO signal_feedback(subject_id,subject_label,sig_kind,basis,osis,stance,suggested,comment,author,created_at,verdict,author_sub,proposed_action,assertion) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(subject, String(b.subject_label ?? '').slice(0, 120), String(b.sig_kind ?? '').slice(0, 60), String(b.basis ?? '').slice(0, 400), String(b.osis ?? '').slice(0, 40), stance, String(b.suggested ?? '').slice(0, 40), comment.slice(0, 1500), author, now, String(b.verdict ?? '').slice(0, 40), String(b.author_sub ?? '').slice(0, 120), String(b.proposed_action ?? '').slice(0, 40), b.assertion ? String(b.assertion).slice(0, 12000) : null).run();
  return c.json({ ok: true });
});

// Ask the trust agent (Claude) to validate/challenge a signal against Scripture. Needs ANTHROPIC_API_KEY.
app.post('/api/analyze', async (c) => {
  const key = c.env.ANTHROPIC_API_KEY;
  if (!key) return c.json({ ok: false, error: 'unconfigured', analysis: 'The trust agent is not configured yet. Set the ANTHROPIC_API_KEY secret on this worker (`wrangler secret put ANTHROPIC_API_KEY`) to enable live signal challenges.' });
  const b = await c.req.json().catch(() => ({})) as Record<string, string>;
  const label = String(b.subject_label ?? 'this entity').slice(0, 120);
  const kind = String(b.sig_kind ?? 'signal').slice(0, 60);
  const basis = String(b.basis ?? '').slice(0, 400);
  const osis = String(b.osis ?? '').slice(0, 40);
  const prompt = `You are a Scripture-grounded trust auditor for a Bible knowledge graph. Audit ONE trust signal, scoped STRICTLY to its cited verse and entity. The only question is: does THIS specific verse, read in its own context, support THIS specific signal for THIS specific entity?\n\nEntity: ${label}\nSignal (dimension/type): ${kind}\nSignal basis (the claim): "${basis}"\nCited verse (OSIS): ${osis || '(none)'}\n\nIn ≤200 words, markdown (short **bold** lead-ins + bullet points "- "; NO tables):\n- **Verse in context** — what ${osis || 'the cited verse'} actually says/recounts in its passage.\n- **Support check** — does that verse support this signal's claim for ${label}? Mark ✅ clearly supports / ⚠️ weak or partial / ❌ does not support, and say concretely why.\n- **Verdict** — is this signal VALID for this verse and this entity, and does its polarity/strength fit what the verse shows?\n- **Recommendation** — about THIS signal–verse–entity triple ONLY: keep as-is; tighten the wording so it matches what the verse actually says; or flag the citation as not supporting the claim so a curator can review it. Do NOT propose a different verse, and do NOT invent a different signal or claim.\nStay strictly on the cited verse — do NOT validate the claim using other passages, and do NOT recommend swapping in another verse. If the basis pins one individual's act on a whole group, note it.`;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: c.env.ANALYZE_MODEL || 'claude-sonnet-4-6', max_tokens: 700, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!r.ok) return c.json({ ok: false, error: `agent ${r.status}`, analysis: `The trust agent returned an error (${r.status}). Check the API key / model.` });
    const j = await r.json() as { content?: { text?: string }[] };
    return c.json({ ok: true, analysis: j.content?.[0]?.text ?? '(no response)' });
  } catch (e) {
    return c.json({ ok: false, error: 'fetch failed', analysis: 'Could not reach the trust agent.' });
  }
});

export default app;
