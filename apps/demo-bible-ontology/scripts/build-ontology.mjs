// Build the Bible ontology graph from the Theographic Bible Metadata (CC-BY-SA)
// into a multi-layer ontology: DUL (upper) ⊃ PROV-O (mid) ⊃ { W3C ORG (membership),
// GeoSPARQL (geo), agenticprimitives skills (aps:) } ⊃ Global Church + Bible-lower (gc:).
//
// Emits chunked D1 import SQL: ontology_class, ontology_prop, node, edge, node_verse.
//   node  = instances (people→Agent, orgs→Agent[typed], events→Activity, places→Entity+geo:Feature,
//           roles, reified memberships, skills, responsibilities), each tagged with its class in every layer.
//   edge  = typed relationships (family, org membership, participation, roles, skills, geometry).
//   node_verse = node↔verse links (every object's verse provenance).
//
//   node scripts/build-ontology.mjs   (writes .data/ontology/*.sql + prints counts)

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const T = join(ROOT, '.data', 'theographic');
const OUT = join(ROOT, '.data', 'ontology');
const load = (f) => JSON.parse(readFileSync(join(T, f), 'utf8'));
const esc = (s) => String(s ?? '').replace(/'/g, "''");
const yr = (v) => {
  if (v == null) return null;
  const m = String(v).match(/-?\d+/);
  return m ? parseInt(m[0], 10) : null;
};

// ─── Ontology vocabulary (classes) across the layers ──────────────────────────
const CLASSES = [
  // DUL upper
  ['dul:Entity', 'Entity', 'dul', null], ['dul:Object', 'Object', 'dul', 'dul:Entity'], ['dul:Event', 'Event', 'dul', 'dul:Entity'],
  ['dul:Agent', 'Agent', 'dul', 'dul:Object'], ['dul:SocialAgent', 'Social Agent', 'dul', 'dul:Agent'], ['dul:Person', 'Person', 'dul', 'dul:Agent'],
  ['dul:Organization', 'Organization', 'dul', 'dul:SocialAgent'], ['dul:Place', 'Place', 'dul', 'dul:Object'], ['dul:Role', 'Role', 'dul', 'dul:Concept'],
  ['dul:Concept', 'Concept', 'dul', 'dul:Entity'], ['dul:Description', 'Description', 'dul', 'dul:Entity'], ['dul:Situation', 'Situation', 'dul', 'dul:Entity'], ['dul:TimeInterval', 'Time Interval', 'dul', 'dul:Entity'],
  // DOLCE+DnS — Descriptions, Situations & Assertions (upper)
  ['dul:InformationObject', 'Information Object', 'dul', 'dul:Object'], ['dul:Parameter', 'Parameter', 'dul', 'dul:Concept'],
  ['dns:Assertion', 'Assertion', 'dns', 'dul:InformationObject'], ['dns:SituationType', 'Situation Type', 'dns', 'dul:Description'],
  // Belief–Desire–Intention (upper — propositional attitudes)
  ['bdi:MentalAttitude', 'Mental Attitude', 'bdi', 'dul:Concept'], ['bdi:Belief', 'Belief', 'bdi', 'bdi:MentalAttitude'],
  ['bdi:Desire', 'Desire', 'bdi', 'bdi:MentalAttitude'], ['bdi:Intention', 'Intention', 'bdi', 'bdi:MentalAttitude'], ['bdi:Goal', 'Goal', 'bdi', 'bdi:Intention'],
  // Knowledge vs Wisdom — DIKW epistemic layer (upper)
  ['epi:Data', 'Data', 'epi', 'dul:InformationObject'], ['epi:Information', 'Information', 'epi', 'dul:InformationObject'],
  ['epi:Knowledge', 'Knowledge', 'epi', 'dul:Concept'], ['epi:Understanding', 'Understanding', 'epi', 'epi:Knowledge'], ['epi:Wisdom', 'Wisdom', 'epi', 'dul:Concept'],
  // OWL-Time temporal ontology (aligned: an Activity's start/end are prov:startedAtTime/endedAtTime)
  ['time:TemporalEntity', 'Temporal Entity', 'time', 'dul:Entity'], ['time:Interval', 'Interval', 'time', 'time:TemporalEntity'],
  ['time:ProperInterval', 'Proper Interval', 'time', 'time:Interval'], ['time:Instant', 'Instant', 'time', 'time:TemporalEntity'],
  // geo feature types (GeoSPARQL / gc lower)
  ['gc:Settlement', 'Settlement', 'gc', 'gc:Place'], ['gc:City', 'City', 'gc', 'gc:Settlement'], ['gc:Region', 'Region', 'gc', 'gc:Place'],
  ['gc:Water', 'Water Body', 'gc', 'gc:Place'], ['gc:River', 'River', 'gc', 'gc:Water'], ['gc:Mountain', 'Mountain', 'gc', 'gc:Place'],
  // trust signals — positive/negative assessments of agents + activities (aligns to GCO Assessment)
  ['gc:Assessment', 'Assessment', 'gc', 'dns:Assertion'], ['gc:Signal', 'Trust Signal', 'gc', 'gc:Assessment'],
  ['gc:PositiveSignal', 'Positive Signal', 'gc', 'gc:Signal'], ['gc:NegativeSignal', 'Negative Signal', 'gc', 'gc:Signal'],
  // PROV-O mid (aligned under DUL)
  ['prov:Agent', 'prov:Agent', 'prov', 'dul:Agent'], ['prov:Person', 'prov:Person', 'prov', 'prov:Agent'], ['prov:Organization', 'prov:Organization', 'prov', 'prov:Agent'],
  ['prov:Activity', 'prov:Activity', 'prov', 'dul:Event'], ['prov:Entity', 'prov:Entity', 'prov', 'dul:Object'],
  // W3C ORG (membership)
  ['org:Organization', 'org:Organization', 'org', 'prov:Organization'], ['org:FormalOrganization', 'Formal Organization', 'org', 'org:Organization'],
  ['org:OrganizationalUnit', 'Organizational Unit', 'org', 'org:Organization'], ['org:Membership', 'Membership', 'org', 'dul:Situation'],
  ['org:Role', 'org:Role', 'org', 'dul:Role'], ['org:Post', 'Post', 'org', 'dul:Role'],
  // GeoSPARQL (geo)
  ['geo:Feature', 'Geo Feature', 'geo', 'prov:Entity'], ['geo:Geometry', 'Geometry', 'geo', 'dul:Object'],
  // agenticprimitives skills
  ['aps:Skill', 'Skill', 'aps', 'dul:Concept'], ['aps:SkillClaim', 'Skill Claim', 'aps', 'dul:Description'],
  // Global Church + Bible-lower (gc:)
  ['gc:Person', 'Bible Person', 'gc', 'prov:Person'], ['gc:AgentiveEkklesia', 'Assembly / Ekklesia', 'gc', 'org:FormalOrganization'],
  ['gc:Community', 'Community', 'gc', 'org:Organization'], ['gc:Tribe', 'Tribe', 'gc', 'org:OrganizationalUnit'], ['gc:Nation', 'Nation', 'gc', 'org:FormalOrganization'],
  ['gc:House', 'House / Lineage', 'gc', 'org:OrganizationalUnit'], ['gc:ApostolicBody', 'Apostolic Body', 'gc', 'gc:AgentiveEkklesia'],
  ['gc:BiblicalEvent', 'Biblical Event', 'gc', 'prov:Activity'], ['gc:Covenant', 'Covenant', 'gc', 'dul:Description'],
  ['gc:Place', 'Biblical Place', 'gc', 'geo:Feature'], ['gc:Responsibility', 'Responsibility', 'gc', 'dul:Concept'],
  // gc roles (Bible usage)
  ...[['Patriarch'], ['Matriarch'], ['Prophet'], ['Prophetess'], ['Priest'], ['HighPriest', 'High Priest'], ['King'], ['Queen'], ['Judge'], ['Apostle'], ['Disciple'], ['Levite'], ['Elder'], ['Deacon'], ['Evangelist'], ['Leader'], ['Governor'], ['Scribe'], ['Shepherd'], ['Messiah']].map(([r, l]) => [`gc:${r}`, l ?? r, 'gc', 'org:Role']),
];

// ─── Ontology vocabulary (properties / relationship types) ────────────────────
const PROPS = [
  ['prov:wasAssociatedWith', 'was associated with', 'prov', 'prov:Activity', 'prov:Agent', 'gc:participatedIn'],
  ['prov:actedOnBehalfOf', 'acted on behalf of', 'prov', 'prov:Agent', 'prov:Agent', null],
  ['prov:used', 'used', 'prov', 'prov:Activity', 'prov:Entity', null],
  ['prov:wasGeneratedBy', 'was generated by', 'prov', 'prov:Entity', 'prov:Activity', null],
  ['prov:wasDerivedFrom', 'was derived from', 'prov', 'prov:Entity', 'prov:Entity', null],
  ['prov:wasAttributedTo', 'was attributed to', 'prov', 'prov:Entity', 'prov:Agent', null],
  ['dul:hasParticipant', 'has participant', 'dul', 'dul:Event', 'dul:Object', 'dul:isParticipantIn'],
  ['dul:hasLocation', 'has location', 'dul', 'dul:Entity', 'dul:Place', null],
  ['dul:hasRole', 'has role', 'dul', 'dul:Object', 'dul:Role', null],
  ['org:memberOf', 'member of', 'org', 'prov:Agent', 'org:Organization', 'org:hasMember'],
  ['org:hasMembership', 'has membership', 'org', 'prov:Agent', 'org:Membership', null],
  ['org:member', 'member', 'org', 'org:Membership', 'prov:Agent', null],
  ['org:organization', 'organization', 'org', 'org:Membership', 'org:Organization', null],
  ['org:role', 'role', 'org', 'org:Membership', 'org:Role', null],
  ['org:subOrganizationOf', 'sub-organization of', 'org', 'org:Organization', 'org:Organization', null],
  ['geo:hasGeometry', 'has geometry', 'geo', 'geo:Feature', 'geo:Geometry', null],
  ['aps:hasSkill', 'has skill', 'aps', 'prov:Agent', 'aps:Skill', null],
  ['gc:hasParent', 'has parent', 'gc', 'gc:Person', 'gc:Person', 'gc:hasChild'],
  ['gc:hasChild', 'has child', 'gc', 'gc:Person', 'gc:Person', 'gc:hasParent'],
  ['gc:hasSibling', 'has sibling', 'gc', 'gc:Person', 'gc:Person', 'gc:hasSibling'],
  ['gc:hasPartner', 'has partner', 'gc', 'gc:Person', 'gc:Person', 'gc:hasPartner'],
  ['gc:bornAt', 'born at', 'gc', 'gc:Person', 'gc:Place', null],
  ['gc:diedAt', 'died at', 'gc', 'gc:Person', 'gc:Place', null],
  ['gc:participatedIn', 'participated in', 'gc', 'prov:Agent', 'prov:Activity', 'prov:wasAssociatedWith'],
  ['gc:holdsRole', 'holds role', 'gc', 'gc:Person', 'org:Role', null],
  ['gc:hasResponsibility', 'has responsibility', 'gc', 'org:Role', 'gc:Responsibility', null],
  ['gc:attestedIn', 'attested in', 'gc', 'dul:Entity', 'prov:Entity', null], // node → verse
  // DnS situation/assertion relations
  ['dul:satisfies', 'satisfies', 'dns', 'dul:Situation', 'dul:Description', null],
  ['dul:isSettingFor', 'is setting for', 'dns', 'dul:Situation', 'dul:Entity', null],
  ['dul:defines', 'defines', 'dns', 'dul:Description', 'dul:Concept', null],
  ['dul:classifies', 'classifies', 'dns', 'dul:Concept', 'dul:Entity', null],
  // BDI attitudes (Agent → attitude/assertion)
  ['bdi:believes', 'believes', 'bdi', 'prov:Agent', 'dns:Assertion', null],
  ['bdi:desires', 'desires', 'bdi', 'prov:Agent', 'bdi:Desire', null],
  ['bdi:intends', 'intends', 'bdi', 'prov:Agent', 'bdi:Intention', null],
  // epistemic grounding
  ['epi:groundedIn', 'grounded in', 'epi', 'epi:Wisdom', 'epi:Knowledge', null],
  // temporal (PROV-O temporal qualification + OWL-Time)
  ['prov:startedAtTime', 'started at time', 'prov', 'prov:Activity', 'time:Instant', null],
  ['prov:endedAtTime', 'ended at time', 'prov', 'prov:Activity', 'time:Instant', null],
  ['time:hasBeginning', 'has beginning', 'time', 'time:Interval', 'time:Instant', null],
  ['time:hasEnd', 'has end', 'time', 'time:Interval', 'time:Instant', null],
  ['time:before', 'before', 'time', 'time:TemporalEntity', 'time:TemporalEntity', 'time:after'],
  // trust signals
  ['gc:hasSignal', 'has signal', 'gc', 'dul:Entity', 'gc:Signal', null],
  ['gc:assessedBy', 'assessed by', 'gc', 'gc:Signal', 'prov:Entity', null],
];

// Curated positive/negative trust signals (Bible-usage lower ontology seed) by name.
const SIGNALS = [
  ['Abraham', '+', 'faith counted as righteousness'], ['Noah', '+', 'righteous and blameless'], ['Enoch', '+', 'walked with God'],
  ['Joseph', '+', 'integrity in Egypt'], ['Moses', '+', 'faithful servant'], ['Joshua', '+', 'courage and obedience'],
  ['Ruth', '+', 'covenant loyalty'], ['David', '+', 'a man after God’s own heart'], ['Daniel', '+', 'faithful under pressure'],
  ['Job', '+', 'blameless and upright'], ['Mary, mother of Jesus', '+', 'favored, faithful'], ['Stephen', '+', 'faithful witness'],
  ['Paul', '+', 'zeal for the gospel'], ['Barnabas', '+', 'son of encouragement'], ['Esther', '+', 'courage for her people'],
  ['Cain', '-', 'murdered his brother'], ['Pharaoh', '-', 'hardened his heart'], ['Korah', '-', 'rebellion'],
  ['Achan', '-', 'theft + covenant breach'], ['Saul', '-', 'disobedience + jealousy'], ['Ahab', '-', 'promoted idolatry'],
  ['Jezebel', '-', 'idolatry + murder'], ['Jeroboam', '-', 'led Israel into sin'], ['Judas Iscariot', '-', 'betrayed Jesus'],
  ['Herod', '-', 'murdered the innocents'], ['Ananias', '-', 'deceit'], ['David', '-', 'adultery + Uriah’s death'],
  ['Solomon', '-', 'turned to idols in old age'],
  // organizations + events
  ['Apostles', '+', 'commissioned witnesses'], ['Nation of Israel', '~', 'covenant people, yet recurring rebellion'],
  ['Exodus', '+', 'deliverance from bondage'], ['Resurrection of Jesus', '+', 'victory over death'],
];

// roles → (skill, responsibility) — the lower-ontology vocabulary grown from Bible usage
const ROLE_DEF = {
  King: ['Kingship', 'Govern the people'], Queen: ['Kingship', 'Govern the people'], Governor: ['Leadership', 'Administer a region'],
  Prophet: ['Prophecy', "Speak God's word"], Prophetess: ['Prophecy', "Speak God's word"], Priest: ['Priesthood', 'Offer sacrifices + intercede'],
  HighPriest: ['Priesthood', 'Lead worship + atonement'], Judge: ['Leadership', 'Deliver + judge Israel'], Apostle: ['Apostleship', 'Found + lead the church'],
  Disciple: ['Discipleship', 'Follow + learn'], Levite: ['Priesthood', 'Serve the temple'], Elder: ['Leadership', 'Oversee the assembly'],
  Deacon: ['Service', 'Serve the assembly'], Evangelist: ['Evangelism', 'Proclaim the gospel'], Patriarch: ['Leadership', 'Lead the family line'],
  Matriarch: ['Leadership', 'Lead the family line'], Leader: ['Leadership', 'Lead the people'], Shepherd: ['Shepherding', 'Tend the flock'],
  Scribe: ['Teaching', 'Copy + teach the law'], Messiah: ['Leadership', 'Redeem + reign'],
};
const SKILLS = [...new Set(Object.values(ROLE_DEF).map((r) => r[0]))];

// curated role assignments for key figures (Bible-usage lower ontology seed)
const PERSON_ROLE = {
  Abraham: 'Patriarch', Isaac: 'Patriarch', Jacob: 'Patriarch', Joseph: 'Governor', Moses: 'Prophet', Aaron: 'HighPriest', Joshua: 'Leader',
  Samuel: 'Prophet', Saul: 'King', David: 'King', Solomon: 'King', Elijah: 'Prophet', Elisha: 'Prophet', Isaiah: 'Prophet', Jeremiah: 'Prophet',
  Ezekiel: 'Prophet', Daniel: 'Prophet', Deborah: 'Judge', Gideon: 'Judge', Samson: 'Judge', Esther: 'Queen', Nehemiah: 'Governor',
  Peter: 'Apostle', Paul: 'Apostle', John: 'Apostle', James: 'Apostle', Andrew: 'Apostle', Matthew: 'Apostle', Thomas: 'Apostle', Philip: 'Apostle',
  Stephen: 'Deacon', Timothy: 'Evangelist', 'Mary, mother of Jesus': 'Matriarch', Sarah: 'Matriarch', Eve: 'Matriarch',
};
// org name → (org class, role its members hold)
function classifyOrg(name) {
  if (/^Tribe of/i.test(name)) return ['gc:Tribe', 'org:OrganizationalUnit', name.includes('Levi') ? 'Levite' : null];
  if (/^Nation of/i.test(name)) return ['gc:Nation', 'org:FormalOrganization', null];
  if (/Apostles/i.test(name)) return ['gc:ApostolicBody', 'gc:AgentiveEkklesia', 'Apostle'];
  if (/(Line|Genealogy) of/i.test(name)) return ['gc:House', 'org:OrganizationalUnit', null];
  return ['gc:Community', 'org:Organization', null];
}

function main() {
  const people = load('people.json');
  const groups = load('peopleGroups.json');
  const events = load('events.json');
  const places = load('places.json');
  const verses = load('verses.json');

  const verseOsis = new Map(verses.map((v) => [v.id, v.fields.osisRef])); // verse recID → osis

  const nodes = [];
  const edges = [];
  const nodeVerse = [];
  const known = new Set();
  const addNode = (n) => {
    nodes.push(n);
    known.add(n.id);
  };
  const addEdge = (src, rel, dst, ctx = null) => edges.push({ src, rel, dst, ctx });
  const linkVerses = (id, verseIds) => {
    for (const vr of verseIds ?? []) {
      const osis = verseOsis.get(vr);
      if (osis) nodeVerse.push({ id, osis });
    }
  };

  // skills + responsibilities + roles (vocabulary nodes)
  for (const s of SKILLS) addNode({ id: `skill:${s}`, label: s, kind: 'skill', prov: null, dul: 'dul:Concept', gc: null, aps: 'aps:Skill', extra: {} });
  const respSet = new Set();
  for (const [role, [skill, resp]] of Object.entries(ROLE_DEF)) {
    addNode({ id: `role:${role}`, label: role, kind: 'role', prov: null, dul: 'dul:Role', gc: `gc:${role}`, aps: null, extra: {} });
    if (!respSet.has(resp)) {
      respSet.add(resp);
      addNode({ id: `resp:${resp}`, label: resp, kind: 'responsibility', prov: null, dul: 'dul:Concept', gc: 'gc:Responsibility', aps: null, extra: {} });
    }
    addEdge(`role:${role}`, 'gc:hasResponsibility', `resp:${resp}`);
    addEdge(`role:${role}`, 'aps:relatedSkill', `skill:${skill}`);
  }

  // organizations (typed)
  const orgRoleOfMember = new Map();
  for (const g of groups) {
    const name = g.fields.groupName ?? 'Group';
    const [gc, orgClass, memberRole] = classifyOrg(name);
    addNode({ id: g.id, label: name, kind: 'organization', prov: 'prov:Organization', dul: 'dul:Organization', gc, aps: null, orgClass, extra: {} });
    if (memberRole) orgRoleOfMember.set(g.id, memberRole);
    for (const m of g.fields.members ?? []) addEdge(g.id, 'org:hasMember', m); // resolved after people loaded
  }

  // people → prov:Agent (+ role/skill/membership)
  for (const p of people) {
    const f = p.fields;
    addNode({ id: p.id, label: f.name ?? 'Person', kind: 'person', prov: 'prov:Person', dul: 'dul:Person', gc: 'gc:Person', aps: null, tStart: yr(f.birthYear), tEnd: yr(f.deathYear), extra: { gender: f.gender, birthYear: f.birthYear, deathYear: f.deathYear } });
    linkVerses(p.id, f.verses);
  }
  // resolve org membership (reified + convenience) + member roles/skills
  for (const g of groups) {
    const memberRole = orgRoleOfMember.get(g.id);
    for (const m of g.fields.members ?? []) {
      if (!known.has(m)) continue;
      addEdge(m, 'org:memberOf', g.id);
      const mid = `mem:${g.id}:${m}`;
      addNode({ id: mid, label: 'membership', kind: 'membership', prov: null, dul: 'dul:Situation', gc: null, aps: null, extra: {} });
      addEdge(mid, 'org:member', m);
      addEdge(mid, 'org:organization', g.id);
      if (memberRole) {
        addEdge(mid, 'org:role', `role:${memberRole}`);
        addEdge(m, 'gc:holdsRole', `role:${memberRole}`, g.id);
        const sk = ROLE_DEF[memberRole]?.[0];
        if (sk) addEdge(m, 'aps:hasSkill', `skill:${sk}`);
      }
    }
  }
  // family + birth/death place + curated roles
  for (const p of people) {
    const f = p.fields;
    for (const x of [...(f.father ?? []), ...(f.mother ?? [])]) if (known.has(x)) addEdge(p.id, 'gc:hasParent', x);
    for (const x of f.children ?? []) if (known.has(x)) addEdge(p.id, 'gc:hasChild', x);
    for (const x of f.siblings ?? []) if (known.has(x)) addEdge(p.id, 'gc:hasSibling', x);
    for (const x of f.partners ?? []) if (known.has(x)) addEdge(p.id, 'gc:hasPartner', x);
    const role = PERSON_ROLE[f.name];
    if (role) {
      addEdge(p.id, 'gc:holdsRole', `role:${role}`);
      const sk = ROLE_DEF[role]?.[0];
      if (sk) addEdge(p.id, 'aps:hasSkill', `skill:${sk}`);
    }
  }

  // places → prov:Entity + geo:Feature (geometry)
  for (const pl of places) {
    const f = pl.fields;
    const lat = parseFloat(f.latitude ?? f.openBibleLat);
    const lon = parseFloat(f.longitude ?? f.openBibleLong);
    addNode({ id: pl.id, label: f.kjvName ?? f.esvName ?? f.displayTitle ?? 'Place', kind: 'place', prov: 'prov:Entity', dul: 'dul:Place', gc: 'gc:Place', aps: null, geoClass: 'geo:Feature', lat: isFinite(lat) ? lat : null, lon: isFinite(lon) ? lon : null, wkt: isFinite(lat) && isFinite(lon) ? `POINT(${lon} ${lat})` : null, extra: { featureType: f.featureType, featureSubType: f.featureSubType } });
    linkVerses(pl.id, f.verses);
  }
  // person birth/death place (after places known)
  for (const p of people) {
    const f = p.fields;
    for (const x of f.birthPlace ?? []) if (known.has(x)) addEdge(p.id, 'gc:bornAt', x);
    for (const x of f.deathPlace ?? []) if (known.has(x)) addEdge(p.id, 'gc:diedAt', x);
  }

  // events → prov:Activity (+ participants, verses)
  for (const e of events) {
    const f = e.fields;
    addNode({ id: e.id, label: f.title ?? 'Event', kind: 'event', prov: 'prov:Activity', dul: 'dul:Event', gc: 'gc:BiblicalEvent', aps: null, tStart: yr(f.startDate), tEnd: null, extra: { startDate: f.startDate, duration: f.duration } });
    linkVerses(e.id, f.verses);
    for (const part of f.participants ?? []) if (known.has(part)) addEdge(e.id, 'prov:wasAssociatedWith', part);
  }

  // ── emit chunked SQL ──
  mkdirSync(OUT, { recursive: true });
  const files = [];
  const writeChunks = (name, header, rows, toVals, per = 60) => {
    let part = 0;
    for (let i = 0; i < rows.length; i += per) {
      const vals = rows.slice(i, i + per).map(toVals).join(',');
      const f = `${OUT}/${name}_${String(part).padStart(3, '0')}.sql`;
      writeFileSync(f, `${header} VALUES ${vals};\n`);
      files.push(f);
      part++;
    }
  };
  // schema-affecting seeds first (single files)
  writeFileSync(`${OUT}/00_class.sql`, CLASSES.map((c) => `INSERT OR REPLACE INTO ontology_class(curie,label,layer,parent,comment) VALUES('${esc(c[0])}','${esc(c[1])}','${c[2]}',${c[3] ? `'${esc(c[3])}'` : 'NULL'},NULL);`).join('\n') + '\n');
  writeFileSync(`${OUT}/01_prop.sql`, PROPS.map((p) => `INSERT OR REPLACE INTO ontology_prop(curie,label,layer,domain,range_,inverse,comment) VALUES('${esc(p[0])}','${esc(p[1])}','${p[2]}','${esc(p[3])}','${esc(p[4])}',${p[5] ? `'${esc(p[5])}'` : 'NULL'},NULL);`).join('\n') + '\n');
  files.push(`${OUT}/00_class.sql`, `${OUT}/01_prop.sql`);

  writeChunks('node', 'INSERT OR REPLACE INTO node(id,label,kind,prov_class,dul_class,org_class,geo_class,gc_class,aps_class,lat,long,wkt,t_start,t_end,meta)', nodes, (n) =>
    `('${esc(n.id)}','${esc(n.label)}','${n.kind}',${n.prov ? `'${n.prov}'` : 'NULL'},${n.dul ? `'${n.dul}'` : 'NULL'},${n.orgClass ? `'${n.orgClass}'` : 'NULL'},${n.geoClass ? `'${n.geoClass}'` : 'NULL'},${n.gc ? `'${n.gc}'` : 'NULL'},${n.aps ? `'${n.aps}'` : 'NULL'},${n.lat ?? 'NULL'},${n.lon ?? 'NULL'},${n.wkt ? `'${esc(n.wkt)}'` : 'NULL'},${n.tStart ?? 'NULL'},${n.tEnd ?? 'NULL'},'${esc(JSON.stringify(n.extra ?? {}))}')`,
  );
  writeChunks('edge', 'INSERT INTO edge(src,rel,dst,ctx)', edges, (e) => `('${esc(e.src)}','${esc(e.rel)}','${esc(e.dst)}',${e.ctx ? `'${esc(e.ctx)}'` : 'NULL'})`, 80);
  writeChunks('nv', 'INSERT INTO node_verse(node_id,osis)', nodeVerse, (v) => `('${esc(v.id)}','${esc(v.osis)}')`, 120);

  // trust signals — resolve curated names → node ids, attach the first verse as source
  const nameToId = new Map();
  for (const p of people) if (p.fields.name) nameToId.set(p.fields.name, p.id);
  for (const g of groups) if (g.fields.groupName) nameToId.set(g.fields.groupName, g.id);
  for (const e of events) if (e.fields.title) nameToId.set(e.fields.title, e.id);
  const POL = { '+': 'positive', '-': 'negative', '~': 'mixed' };
  const sigRows = [];
  for (const [name, p, basis] of SIGNALS) {
    const id = nameToId.get(name);
    if (!id) continue;
    const osis = (nodeVerse.find((v) => v.id === id) || {}).osis ?? null;
    sigRows.push({ id, pol: POL[p], basis, osis });
  }
  writeFileSync(`${OUT}/signal.sql`, sigRows.map((s) => `INSERT INTO signal(subject_id,polarity,basis,osis) VALUES('${esc(s.id)}','${s.pol}','${esc(s.basis)}',${s.osis ? `'${esc(s.osis)}'` : 'NULL'});`).join('\n') + '\n');
  files.push(`${OUT}/signal.sql`);
  console.log('signals', sigRows.length, '/', SIGNALS.length, 'resolved');

  writeFileSync(`${OUT}/manifest.json`, JSON.stringify({ files: files.map((f) => f.replace(OUT + '/', '')), counts: { classes: CLASSES.length, props: PROPS.length, nodes: nodes.length, edges: edges.length, nodeVerse: nodeVerse.length } }, null, 2));
  const byKind = nodes.reduce((a, n) => ((a[n.kind] = (a[n.kind] ?? 0) + 1), a), {});
  console.log('classes', CLASSES.length, '| props', PROPS.length);
  console.log('nodes', nodes.length, JSON.stringify(byKind));
  console.log('edges', edges.length, '| node_verse', nodeVerse.length, '| sql files', files.length);
}
main();
