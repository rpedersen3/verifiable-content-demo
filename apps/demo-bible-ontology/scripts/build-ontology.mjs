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
import { ingestSources, ingestInteractions, ingestMacula, ingestPlans, ingestMovements, ingestChurches } from './ingest-sources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const T = join(ROOT, '.data', 'theographic');
const OUT = join(ROOT, '.data', 'ontology');
const load = (f) => JSON.parse(readFileSync(join(T, f), 'utf8'));
const esc = (s) => String(s ?? '').replace(/'/g, "''");
const yr = (v) => {
  if (v == null) return null;
  const m = String(v).match(/-?\d+/);
  return m ? parseInt(m[0], 10) : null;
};
const ord = (y) => (y == null ? null : `${Math.abs(y)} ${y < 0 ? 'BC' : 'AD'}`);
const slugify = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
// "also known as": distinct name forms (label + canonical-slug name so "Peter" finds the node
// labelled "Simon" + curated alternate names). Stored pipe-separated so it's both LIKE-searchable
// (SQLite LIKE is case-insensitive) AND displayable as an alias list in the explorer.
const AKA_EXTRA = {
  israel_682: ['Jacob'], peter_2745: ['Cephas', 'Simon Peter'], jesus_905: ['Christ', 'Messiah', 'Jesus of Nazareth'],
  saul_2478: ['King Saul'], paul_2331: ['Saul of Tarsus'], abraham_58: ['Abram'], sarah_60: ['Sarai'],
  'nation-of-israel': ['Israel', 'House of Israel'],
};
const titleCase = (s) => String(s).replace(/\b\w/g, (c) => c.toUpperCase());
const akaOf = (n) => {
  const slug = titleCase(String(n.canonId ?? '').replace(/_[A-Za-z0-9]+$/, '').replace(/[-_]/g, ' ').trim());
  const forms = [n.label, slug, ...(AKA_EXTRA[n.canonId] ?? []), ...(n.akaExtra ?? [])].filter(Boolean);
  const seen = new Set(); const out = [];
  for (const f of forms) { const k = String(f).toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(f); } }
  return out.join('|').slice(0, 240);
};

// ─── External enrichment (Wikidata/Commons): canonical authority + licensed images ──
// Curated, verified mapping committed at apps/.../data/wikidata-enrichment.json.
// Regenerate with: node scripts/fetch-enrichment.mjs  (writes that JSON from Wikidata + Commons).
const ENRICH = (() => {
  try { return JSON.parse(readFileSync(join(HERE, '..', 'data', 'wikidata-enrichment.json'), 'utf8')); }
  catch { console.warn('no enrichment JSON — images/authority skipped'); return []; }
})();
const dedupe = (s) => { const t = String(s ?? '').trim(); if (!t) return null; const h = t.slice(0, t.length / 2); return h && h + h === t ? h : t; }; // "Unknown artistUnknown artist" → "Unknown artist"
// enrichment record name → its acceptable Theographic place/event labels (names differ across datasets)
const PERSON_ALIAS = { Rebecca: 'Rebekah' };
const PLACE_ALIAS = { 'Jordan River': 'Jordan', 'Mount Sinai': 'mount Sinai', 'Sea of Galilee': 'sea of Galilee', 'Mount of Olives': 'mount of Olives', 'Garden of Eden': 'Eden', 'Red Sea': 'Red sea' };
const EVENT_ALIAS = { Creation: 'Creation of all things', Flood: 'The Great Flood', Exodus: 'Exodus from Egypt', Crucifixion: 'Crucifixion and Burial', Resurrection: 'Resurrection and Ascension', 'Last Supper': 'The Last Supper', 'Tower of Babel': 'Tower of Babel', Nativity: 'Birth of Jesus' };

// ─── Trust-score curation (the computed dimensions are derived later from the graph) ──
// moral (good↔evil, −1..+1): fine overrides on top of the +/−/~ signal seed.
const MORAL_FINE = { Jesus: 1.0, 'Judas Iscariot': -0.95, Herod: -0.85, Cain: -0.85, Jezebel: -0.85, Pharaoh: -0.8, Ahab: -0.75, Jeroboam: -0.7, Saul: -0.45, Solomon: 0.35, David: 0.45, Abraham: 0.85, Moses: 0.85, Noah: 0.85, Paul: 0.85, Mary: 0.9, Stephen: 0.85, Ruth: 0.85, Daniel: 0.85, Joseph: 0.8, Esther: 0.8 };
// historical_trust (extra-biblical corroboration, 0..1) — by entity name, attached only where a node exists.
const HISTORICAL = {
  // people with epigraphic / archaeological attestation
  David: [0.7, 'Tel Dan Stele — “House of David” (9th c. BC)'], Ahab: [0.9, 'Kurkh Monolith of Shalmaneser III'], Jehu: [0.95, 'Black Obelisk of Shalmaneser III'], Omri: [0.9, 'Mesha (Moabite) Stele'], Hezekiah: [0.95, 'Siloam inscription + LMLK + royal bullae'], 'Pontius Pilate': [0.95, 'Pilate Stone, Caesarea (1961)'], Caiaphas: [0.85, 'Caiaphas ossuary, Jerusalem (1990)'], Herod: [0.95, 'Herodium + extensive building archaeology'], Sennacherib: [1.0, 'Annals / Taylor Prism, Lachish reliefs'], Nebuchadnezzar: [1.0, 'Babylonian Chronicles + brick stamps'], Cyrus: [1.0, 'Cyrus Cylinder'], Solomon: [0.4, 'monumental gates debated (Megiddo/Gezer/Hazor)'], Jesus: [0.7, 'Tacitus, Annals 15.44; Josephus'], Paul: [0.5, 'Gallio inscription at Delphi anchors the date'],
  // places — well-excavated sites
  Jerusalem: [1.0, 'continuously excavated capital'], Babylon: [1.0, 'excavated Neo-Babylonian capital'], Nineveh: [1.0, 'excavated Assyrian capital'], Damascus: [0.95, 'continuously inhabited city'], Rome: [1.0, 'imperial capital'], Jericho: [0.9, 'Tell es-Sultan excavations'], Samaria: [0.9, 'Omride palace + Samaria ostraca'], Hebron: [0.85, 'Bronze/Iron Age tell'], Bethlehem: [0.75, 'Iron Age settlement; bulla'], Nazareth: [0.7, 'Roman-era village remains'], Capernaum: [0.9, 'excavated synagogue + house of Peter'], Babylonia: [1.0, 'Neo-Babylonian records'],
};
const POLVAL = { positive: 1, negative: -1, mixed: 0 };
// Approximate lifespans (scholarly estimates) for key figures Theographic leaves undated — chiefly
// the New Testament generation, so "people from Jesus' time" appear on the timeline. Applied only
// where the node has no date; resolved to the most-attested node of that name.
const FLOR_DATES = {
  Peter: [1, 64], Paul: [5, 67], John: [6, 100], James: [1, 62], Andrew: [5, 60], Matthew: [5, 74], Thomas: [1, 72],
  Philip: [5, 80], Bartholomew: [1, 70], Stephen: [1, 34], Barnabas: [1, 61], Timotheus: [17, 97], Titus: [10, 105],
  'Mary, mother of Jesus': [-18, 48], Mary: [-18, 48], Caiaphas: [-14, 46], 'Judas Iscariot': [1, 33], Judas: [1, 33],
  Nathanael: [1, 70], Nicodemus: [1, 70], Lazarus: [1, 63], Martha: [1, 60], Mark: [5, 68], Luke: [10, 84],
  Cornelius: [1, 60], Gamaliel: [-20, 52], Matthias: [1, 80], Jude: [1, 70], Herod: [-20, 39], Pilate: [-10, 39],
  Philemon: [5, 70], Silas: [1, 70], Apollos: [1, 75], Aquila: [1, 70], Priscilla: [1, 70], Lydia: [1, 70],
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
  // DOLCE+DnS attestation/corroboration: a source's claim about an entity is a dns:Assertion; the
  // trust signal derived from agreeing, independent assertions is a gc:Assessment (⊂ dns:Assertion).
  ['gc:Attestation', 'Source Attestation', 'gc', 'dns:Assertion'], ['gc:SourceAssessment', 'Corroboration Assessment', 'gc', 'gc:Assessment'],
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
  // fine-grained interactions (conversation level) — speech acts, letters, encounters between agents
  ['gc:Interaction', 'Interaction', 'gc', 'gc:BiblicalEvent'], ['gc:Correspondence', 'Correspondence (Letter)', 'gc', 'gc:Interaction'],
  ['gc:SpeechAct', 'Speech Act', 'gc', 'gc:Interaction'], ['gc:Encounter', 'Encounter', 'gc', 'gc:Interaction'],
  // illocutionary speech-act taxonomy (Searle) — each is a prov:Activity; a Directive prescribes a plan step
  ['gc:Assertive', 'Assertive', 'gc', 'gc:SpeechAct'], ['gc:Statement', 'Statement', 'gc', 'gc:Assertive'], ['gc:Answer', 'Answer', 'gc', 'gc:Assertive'],
  ['gc:Directive', 'Directive', 'gc', 'gc:SpeechAct'], ['gc:Request', 'Request', 'gc', 'gc:Directive'], ['gc:Command', 'Command', 'gc', 'gc:Directive'], ['gc:Question', 'Question', 'gc', 'gc:Directive'],
  ['gc:Commissive', 'Commissive', 'gc', 'gc:SpeechAct'], ['gc:Promise', 'Promise', 'gc', 'gc:Commissive'], ['gc:Oath', 'Oath / Covenant Vow', 'gc', 'gc:Commissive'],
  ['gc:Expressive', 'Expressive', 'gc', 'gc:SpeechAct'], ['gc:Blessing', 'Blessing', 'gc', 'gc:Expressive'], ['gc:Lament', 'Lament', 'gc', 'gc:Expressive'],
  // P-Plan (PROV-O plan extension) + DOLCE: a Plan is a Description that defines ordered Steps; an Activity executes a Step
  ['prov:Plan', 'prov:Plan', 'prov', 'prov:Entity'],
  ['pplan:Plan', 'Plan', 'pplan', 'dul:Description'], ['pplan:Step', 'Plan Step', 'pplan', 'dul:Concept'], ['pplan:Activity', 'Plan Activity (doing)', 'pplan', 'prov:Activity'],
  // EP-Plan (executable plan) — executable plans/steps with preconditions & constraints
  ['epplan:ExecutablePlan', 'Executable Plan', 'epplan', 'pplan:Plan'], ['epplan:ExecutableStep', 'Executable Step', 'epplan', 'pplan:Step'],
  ['epplan:Precondition', 'Precondition', 'epplan', 'dul:Description'], ['epplan:Constraint', 'Constraint', 'epplan', 'dul:Description'],
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
  // DnS attestation/corroboration relations: an entity is the setting for source Assertions;
  // each Assertion is asserted by a source Agent about the entity, and may corroborate others.
  // interaction roles — who authored/spoke and who was addressed (⊂ prov:wasAssociatedWith)
  ['gc:authoredBy', 'authored by', 'gc', 'gc:Correspondence', 'prov:Agent', 'gc:authorOf'],
  ['gc:addressedTo', 'addressed to', 'gc', 'gc:Interaction', 'prov:Agent', null],
  ['gc:hasSpeaker', 'has speaker', 'gc', 'gc:SpeechAct', 'prov:Agent', null],
  ['gc:hasAddressee', 'has addressee', 'gc', 'gc:Interaction', 'prov:Agent', null],
  // conversation-level relationship extracted from MACULA (who speaks to whom, aggregated)
  ['gc:spokeTo', 'spoke to', 'gc', 'prov:Agent', 'prov:Agent', 'gc:spokenToBy'],
  // generational / derivation — what an organization grew out of (founder, antecedent group)
  ['gc:grewOutOf', 'grew out of', 'gc', 'prov:Organization', 'prov:Agent', 'gc:gaveRiseTo'],
  ['gc:gaveRiseTo', 'gave rise to', 'gc', 'prov:Agent', 'prov:Organization', 'gc:grewOutOf'],
  ['org:hasSubOrganization', 'has sub-organization', 'org', 'org:Organization', 'org:Organization', 'org:subOrganizationOf'],
  // spiritual generations — discipleship / mentorship + church planting (movements grow from people)
  ['gc:discipled', 'discipled', 'gc', 'prov:Agent', 'prov:Agent', 'gc:discipleOf'],
  ['gc:planted', 'planted', 'gc', 'prov:Agent', 'gc:AgentiveEkklesia', 'gc:plantedBy'],
  // P-Plan / EP-Plan + DOLCE planning relations (planning · requests · doing)
  ['pplan:isStepOfPlan', 'is step of plan', 'pplan', 'pplan:Step', 'pplan:Plan', 'pplan:isPlanOfStep'],
  ['pplan:isPrecededBy', 'is preceded by', 'pplan', 'pplan:Step', 'pplan:Step', null],
  ['pplan:correspondsToStep', 'corresponds to step', 'pplan', 'pplan:Activity', 'pplan:Step', null],
  ['epplan:hasPrecondition', 'has precondition', 'epplan', 'epplan:ExecutableStep', 'epplan:Precondition', null],
  ['gc:prescribes', 'prescribes', 'gc', 'gc:Directive', 'pplan:Step', null],         // a request/command prescribes a planned step
  ['gc:fulfills', 'fulfills', 'gc', 'pplan:Activity', 'gc:Directive', null],          // a doing fulfils the directive
  ['dul:defines', 'defines', 'dns', 'dul:Description', 'dul:Concept', null],          // Plan (Description) defines its Steps (Concepts)
  ['gc:attestedBy', 'attested by', 'gc', 'dul:Entity', 'gc:Attestation', null],
  ['gc:assertedBy', 'asserted by', 'gc', 'gc:Attestation', 'prov:Agent', 'dul:isSettingFor'],
  ['gc:assertsAbout', 'asserts about', 'gc', 'gc:Attestation', 'dul:Entity', null],
  ['gc:corroborates', 'corroborates', 'gc', 'gc:Attestation', 'gc:Attestation', 'gc:corroborates'],
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
  const byId = new Map();
  const addNode = (n) => {
    nodes.push(n);
    known.add(n.id);
    byId.set(n.id, n);
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
    addNode({ id: g.id, canonId: slugify(name), label: name, kind: 'organization', disambig: (orgClass || 'org:Organization').split(':')[1], prov: 'prov:Organization', dul: 'dul:Organization', gc, aps: null, orgClass, extra: {} });
    if (memberRole) orgRoleOfMember.set(g.id, memberRole);
    for (const m of g.fields.members ?? []) addEdge(g.id, 'org:hasMember', m); // resolved after people loaded
  }

  // people → prov:Agent (+ role/skill/membership)
  for (const p of people) {
    const f = p.fields;
    const span = [ord(yr(f.birthYear)), ord(yr(f.deathYear))].filter(Boolean).join(' – ');
    addNode({ id: p.id, canonId: f.personLookup ?? f.slug, label: f.name ?? 'Person', kind: 'person', disambig: span || (f.gender ?? null), prov: 'prov:Person', dul: 'dul:Person', gc: 'gc:Person', aps: null, authority: f.dictionaryLink ?? null, tStart: yr(f.birthYear), tEnd: yr(f.deathYear), extra: { gender: f.gender, birthYear: f.birthYear, deathYear: f.deathYear } });
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
      const nd = byId.get(p.id);
      if (nd) nd.disambig = [role, nd.disambig].filter(Boolean).join(' · '); // role leads the disambiguator
    }
  }

  // places → prov:Entity + geo:Feature (geometry)
  for (const pl of places) {
    const f = pl.fields;
    const lat = parseFloat(f.latitude ?? f.openBibleLat);
    const lon = parseFloat(f.longitude ?? f.openBibleLong);
    const disp = [f.featureType, f.comment].filter(Boolean).join(' · ') || null;
    addNode({ id: pl.id, canonId: f.placeLookup ?? f.slug, label: f.kjvName ?? f.esvName ?? f.displayTitle ?? 'Place', kind: 'place', disambig: disp, prov: 'prov:Entity', dul: 'dul:Place', gc: 'gc:Place', aps: null, geoClass: 'geo:Feature', authority: f.recogitoUri ?? null, lat: isFinite(lat) ? lat : null, lon: isFinite(lon) ? lon : null, wkt: isFinite(lat) && isFinite(lon) ? `POINT(${lon} ${lat})` : null, extra: { featureType: f.featureType, featureSubType: f.featureSubType } });
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
    addNode({ id: e.id, canonId: `${slugify(f.title)}_${e.id.slice(-4)}`, label: f.title ?? 'Event', kind: 'event', disambig: ord(yr(f.startDate)), prov: 'prov:Activity', dul: 'dul:Event', gc: 'gc:BiblicalEvent', aps: null, tStart: yr(f.startDate), tEnd: null, extra: { startDate: f.startDate, duration: f.duration } });
    linkVerses(e.id, f.verses);
    for (const part of f.participants ?? []) if (known.has(part)) addEdge(e.id, 'prov:wasAssociatedWith', part);
    for (const loc of f.locations ?? []) if (known.has(loc)) addEdge(e.id, 'dul:hasLocation', loc); // event → place (real Theographic data)
  }

  // ── external enrichment: attach Wikidata authority + licensed image to matching nodes ──
  // Match by normalized label/slug-prefix; when a name collides, pick the most-attested record
  // (e.g. 8 "Simon"s → peter_2745). Places/events use a curated alias to bridge dataset naming.
  const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const peopleByKey = new Map();
  const pushKey = (k, id, v) => { if (!k) return; (peopleByKey.get(k) ?? peopleByKey.set(k, []).get(k)).push({ id, v }); };
  for (const p of people) { const v = p.fields.verseCount ?? 0; pushKey(norm(p.fields.name), p.id, v); pushKey(norm((p.fields.personLookup ?? '').split('_')[0]), p.id, v); }
  const placeByLabel = new Map();
  for (const pl of places) { const l = norm(pl.fields.kjvName ?? pl.fields.esvName ?? pl.fields.displayTitle); if (l) (placeByLabel.get(l) ?? placeByLabel.set(l, []).get(l)).push({ id: pl.id, v: pl.fields.verseCount ?? 0 }); }
  const eventByTitle = new Map(events.map((e) => [norm(e.fields.title), e.id]));
  const dedupC = (arr) => { const m = new Map(); for (const c of arr ?? []) m.set(c.id, Math.max(m.get(c.id) ?? -1, c.v)); return [...m].map(([id, v]) => ({ id, v })).sort((a, b) => b.v - a.v); };
  const pickMax = (arr) => { const d = dedupC(arr); return d.length ? d[0].id : null; };
  // Resolve an enrichment record → { id, conf, method, basis }: the CONFIDENCE that this brought-in
  // record (Wikidata/image) is bound to the right canonical id. Exact unique label ≈ rock-solid;
  // a name collision resolved only by verse-dominance, or a label-mismatch (slug-prefix) match, is weaker.
  function resolveMatch(r) {
    const alias = (r.kind === 'person' ? PERSON_ALIAS : r.kind === 'place' ? PLACE_ALIAS : EVENT_ALIAS)[r.name];
    const key = norm(alias ?? r.name);
    if (r.kind === 'event') {
      const id = eventByTitle.get(key); if (!id) return null;
      return alias ? { id, conf: 0.9, method: 'title-alias', basis: `event-title alias “${alias}” → exact` } : { id, conf: 0.96, method: 'title-exact', basis: 'event-title exact match' };
    }
    const cands = dedupC((r.kind === 'person' ? peopleByKey : placeByLabel).get(key));
    if (!cands.length) return null;
    const win = cands[0], nd = byId.get(win.id);
    const labelEq = norm(nd?.label) === key; // matched on the entity's own label vs only its slug prefix
    const method = alias ? 'curated-alias' : labelEq ? 'exact-label' : 'slug-prefix';
    let base = alias ? 0.86 : labelEq ? 0.9 : 0.72; // slug-prefix only (label differs, e.g. Peter labeled “Simon”) is weaker
    let basis;
    if (cands.length === 1) { base = Math.min(0.99, base + 0.08); basis = `${method}, unique (no name collision)`; }
    else {
      const total = cands.reduce((s, c) => s + Math.max(c.v, 0), 0) || 1;
      const dom = win.v / total; // 0.5 ≈ ambiguous · →1 dominant
      base = Math.max(0.4, Math.min(0.99, base + (dom - 0.6) * 0.5));
      basis = `${method}; ${cands.length} same-name candidates, verse-dominance ${win.v} vs ${cands[1].v} (${Math.round(dom * 100)}%)`;
    }
    return { id: win.id, conf: +base.toFixed(2), method, basis };
  }
  let enriched = 0, lowConf = 0;
  for (const r of ENRICH) {
    const m = resolveMatch(r);
    const nd = m && byId.get(m.id);
    if (!nd) continue;
    nd.wikidata = r.wikidata ?? null;
    if (!nd.authority && r.wikidata) nd.authority = r.wikidata;
    nd.imageUrl = r.image ?? null;
    nd.imageThumb = r.thumb ?? null;
    nd.imageLicense = r.license ?? null;
    nd.imageAttr = dedupe(r.artist);
    nd.canonConf = m.conf; // brought-in data lowers the binding confidence below the native 1.0 if the match was fuzzy
    nd.canonMethod = `wikidata:${m.method}`;
    nd.canonBasis = `Wikidata ${r.qid} bound by ${m.basis}`;
    enriched++;
    if (m.conf < 0.85) lowConf++;
  }
  console.log('enriched', enriched, '/', ENRICH.length, 'with image+authority |', lowConf, 'low-confidence (<0.85) bindings flagged');

  // approximate dates for undated key figures (mostly NT) → they appear on the timeline
  let dated = 0;
  for (const [name, [b, d]] of Object.entries(FLOR_DATES)) {
    const id = pickMax(peopleByKey.get(norm(name)));
    const nd = id && byId.get(id);
    if (nd && nd.tStart == null) { nd.tStart = b; nd.tEnd = d; nd.extra = { ...nd.extra, dateApprox: true }; dated++; }
  }
  console.log('floruit dates applied to', dated, 'undated figures');

  // org derivation ("what grew out of what"): tribe/nation/house → eponymous founder; tribes ⊂ nation
  let derived = 0;
  const nationId = groups.find((g) => /^Nation of Israel$/i.test(g.fields.groupName ?? ''))?.id;
  for (const g of groups) {
    const name = g.fields.groupName ?? '';
    const m = name.match(/^(?:Tribe|Nation|House|Line|Genealogy|Sons|Children|Descendants) of (.+)$/i);
    if (m) { const founder = pickMax(peopleByKey.get(norm(m[1]))); if (founder && founder !== g.id) { addEdge(g.id, 'gc:grewOutOf', founder); addEdge(founder, 'gc:gaveRiseTo', g.id); derived++; } }
    if (nationId && /^Tribe of /i.test(name) && g.id !== nationId) { addEdge(g.id, 'org:subOrganizationOf', nationId); addEdge(nationId, 'org:hasSubOrganization', g.id); }
  }
  console.log('org derivation edges:', derived);

  // ── multi-source A-box ingestion: STEPBible TIPNR + OpenBible (reconcile + new nodes) ──
  const addVerseLinks = (id, osises) => { for (const o of osises ?? []) if (o) nodeVerse.push({ id, osis: o }); };
  const ingest = ingestSources({ ROOT, byId, addNode, addEdge, linkVerses, addVerseLinks, peopleByKey, placeByLabel, slugify, norm });
  console.log('ingest · tipnr', JSON.stringify(ingest.stats.tipnr), '· openbible', JSON.stringify(ingest.stats.openbible));
  console.log('ingest · sources', ingest.sources.length, '· xrefs', ingest.xrefs.length, '· node_source', ingest.nodeSources.length, '· forms', ingest.forms.length, '· geo-filled places', ingest.stats.geoFilled);

  // NT churches as assemblies (gc:AgentiveEkklesia) — the groups Paul planted & wrote to
  const versesOf = (id) => nodeVerse.filter((v) => v.id === id).map((v) => v.osis);
  const churches = ingestChurches({ ROOT, byId, addNode, addEdge, addVerseLinks, peopleByKey, placeByLabel, slugify, norm, versesOf });
  console.log('churches ·', churches.count, 'ekklesia (assembly) nodes');

  // curated fine-grained interactions (letters / speech acts) — conversation-level trust-graph edges
  const interactions = ingestInteractions({ ROOT, byId, addNode, addEdge, addVerseLinks, peopleByKey, placeByLabel, slugify, norm, churchByName: churches.map });
  console.log('interactions ·', interactions.count, 'created ·', interactions.edges, 'recipient edges ·', interactions.skipped, 'skipped');

  // MACULA semantic-role extraction → conversation-level gc:spokeTo edges across the Greek NT
  const macula = ingestMacula({ ROOT, byId, addEdge, peopleByKey, norm });
  console.log('macula · speech instances', macula.pairs, '· gc:spokeTo edges', macula.edges);

  // curated planning/speech-act showcase (John 21) — PROV-O + P-Plan + EP-Plan + DOLCE
  const plansOut = ingestPlans({ ROOT, byId, addNode, addEdge, addVerseLinks, peopleByKey, norm });
  console.log('plans ·', plansOut.plans, 'plans ·', plansOut.steps, 'steps ·', plansOut.acts, 'speech acts');

  // spiritual generations — discipleship + church plants (movements) for the generational map
  const mv = ingestMovements({ ROOT, byId, addEdge, peopleByKey, placeByLabel, norm });
  console.log('movements · discipled', mv.discipled, '· planted', mv.planted);

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

  const q = (s) => (s == null ? 'NULL' : `'${esc(s)}'`);
  writeChunks('node', 'INSERT OR REPLACE INTO node(id,canon_id,canon_confidence,canon_method,canon_basis,label,kind,disambig,aka,prov_class,dul_class,org_class,geo_class,gc_class,aps_class,lat,long,wkt,t_start,t_end,wikidata,authority_uri,image_url,image_thumb,image_license,image_attr,image_styled_url,origin_source,meta)', nodes, (n) =>
    `(${q(n.id)},${q(n.canonId)},${n.canonConf ?? 1},${q(n.canonMethod ?? 'source')},${q(n.canonBasis ?? 'native Theographic record id (recID + slug)')},${q(n.label)},'${n.kind}',${q(n.disambig)},${q(akaOf(n))},${q(n.prov)},${q(n.dul)},${q(n.orgClass)},${q(n.geoClass)},${q(n.gc)},${q(n.aps)},${n.lat ?? 'NULL'},${n.lon ?? 'NULL'},${q(n.wkt)},${n.tStart ?? 'NULL'},${n.tEnd ?? 'NULL'},${q(n.wikidata)},${q(n.authority)},${q(n.imageUrl)},${q(n.imageThumb)},${q(n.imageLicense)},${q(n.imageAttr)},${q(n.imageStyled)},${q(n.origin ?? 'theographic')},'${esc(JSON.stringify(n.extra ?? {}))}')`,
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

  // ── transitive subclass closure (ancestor ⊇ class) over ontology_class.parent ──
  // Each class is its own ancestor (depth 0); querying ancestor='prov:Agent' yields prov:Person,
  // prov:Organization, gc:Person, gc:Nation, … so "give me all agents" returns every subclass.
  const parentOf = new Map(CLASSES.map((c) => [c[0], c[3]]));
  const closure = [];
  for (const c of CLASSES) {
    let cur = c[0], depth = 0; const seen = new Set();
    while (cur && !seen.has(cur)) { seen.add(cur); closure.push({ cls: c[0], anc: cur, depth }); cur = parentOf.get(cur) ?? null; depth++; }
  }
  writeFileSync(`${OUT}/02_closure.sql`, closure.map((r) => `INSERT OR REPLACE INTO class_closure(class,ancestor,depth) VALUES('${esc(r.cls)}','${esc(r.anc)}',${r.depth});`).join('\n') + '\n');
  files.push(`${OUT}/02_closure.sql`);

  // ── trust/alignment scores ──
  const verseCount = new Map();
  for (const v of nodeVerse) verseCount.set(v.id, (verseCount.get(v.id) ?? 0) + 1);
  const degree = new Map();
  const bump = (id) => { if (byId.has(id)) degree.set(id, (degree.get(id) ?? 0) + 1); };
  for (const e of edges) { bump(e.src); bump(e.dst); }
  const maxV = Math.max(1, ...verseCount.values());
  const maxD = Math.max(1, ...degree.values());
  const lognorm = (x, max) => (x > 0 ? +(Math.log1p(x) / Math.log1p(max)).toFixed(3) : 0);
  const SCORE_KINDS = new Set(['person', 'place', 'event', 'organization', 'interaction', 'speechact', 'plan']);
  const scoreRows = [];
  // computed: scriptural_trust (verse coverage) + graph_trust (connectivity)
  for (const n of nodes) {
    if (!SCORE_KINDS.has(n.kind)) continue;
    const vc = verseCount.get(n.id) ?? 0, dg = degree.get(n.id) ?? 0;
    scoreRows.push({ id: n.id, dim: 'scriptural_trust', val: lognorm(vc, maxV), basis: `${vc} verse attestations`, method: 'verse-coverage' });
    scoreRows.push({ id: n.id, dim: 'graph_trust', val: lognorm(dg, maxD), basis: `${dg} typed relationships`, method: 'graph-connectivity' });
  }
  // curated: moral (good↔evil) seeded from the +/−/~ signals, with fine overrides
  const moralOf = new Map();
  for (const [name, p, basis] of SIGNALS) {
    const id = nameToId.get(name); if (!id) continue;
    const m = moralOf.get(id) ?? { sum: 0, n: 0, bases: [] };
    m.sum += POLVAL[POL[p]]; m.n++; m.bases.push(basis); moralOf.set(id, m);
  }
  for (const [id, m] of moralOf) {
    const label = byId.get(id)?.label;
    const val = MORAL_FINE[label] != null ? MORAL_FINE[label] : +(0.7 * (m.sum / m.n)).toFixed(3);
    scoreRows.push({ id, dim: 'moral', val, basis: m.bases.join('; '), method: 'curated' });
  }
  // curated: historical_trust (extra-biblical corroboration), attached where the node exists
  for (const [name, [val, basis]] of Object.entries(HISTORICAL)) {
    const id = nameToId.get(name) || pickMax(peopleByKey.get(norm(name))) || pickMax(placeByLabel.get(norm(name)));
    if (id && byId.has(id)) scoreRows.push({ id, dim: 'historical_trust', val, basis, method: 'curated-archaeology' });
  }
  // computed: source_trust — an agentic-trust corroboration signal. Independent, authoritative
  // sources attesting an entity (and agreeing on a stable id) raise confidence it is real and
  // correctly identified; a single-source assertion is weaker. This is provenance-grounded trust.
  const AUTH = { theographic: 1.0, tipnr: 1.0, openbible: 0.9, wikidata: 0.8, pleiades: 0.85, geonames: 0.7 };
  const srcOf = new Map();
  const addSrc = (id, s) => { if (!byId.has(id)) return; (srcOf.get(id) ?? srcOf.set(id, new Set()).get(id)).add(s); };
  for (const n of nodes) addSrc(n.id, n.origin ?? 'theographic');
  for (const ns of ingest.nodeSources) addSrc(ns.nodeId, ns.sourceId);
  for (const x of ingest.xrefs) if (x.scheme === 'wikidata' || x.scheme === 'pleiades' || x.scheme === 'geonames') addSrc(x.nodeId, x.scheme);
  for (const n of nodes) if (n.wikidata) addSrc(n.id, 'wikidata');
  const agree = new Set(ingest.xrefs.filter((x) => x.relation === 'skos:exactMatch' && x.scheme === 'wikidata' && /agree/.test(x.method || '')).map((x) => x.nodeId));
  for (const n of nodes) {
    if (!SCORE_KINDS.has(n.kind)) continue;
    const set = srcOf.get(n.id) ?? new Set([n.origin ?? 'theographic']);
    const w = [...set].reduce((t, s) => t + (AUTH[s] ?? 0.5), 0);
    let val = 1 - Math.pow(0.55, w); // diminishing returns: 1 src ≈ .45, 2 ≈ .70, 3 ≈ .83, 4 ≈ .91
    if (agree.has(n.id)) val = Math.min(1, val + 0.08); // agreeing stable id = strong corroboration
    scoreRows.push({ id: n.id, dim: 'source_trust', val: +val.toFixed(3), basis: `${set.size} independent source assertion${set.size > 1 ? 's' : ''} (dns:Assertion): ${[...set].join(', ')}${agree.has(n.id) ? '; agreeing Wikidata id' : ''}`, method: 'corroboration (gc:SourceAssessment)' });
  }

  writeFileSync(`${OUT}/score.sql`, scoreRows.map((s) => `INSERT OR REPLACE INTO score(subject_id,dimension,value,basis,method) VALUES('${esc(s.id)}','${s.dim}',${s.val},'${esc(s.basis)}','${s.method}');`).join('\n') + '\n');
  files.push(`${OUT}/score.sql`);
  const sByDim = scoreRows.reduce((a, s) => ((a[s.dim] = (a[s.dim] ?? 0) + 1), a), {});
  console.log('closure', closure.length, '| scores', scoreRows.length, JSON.stringify(sByDim));

  // ── multi-source provenance: source registry, cross-references, attestations, forms ──
  writeFileSync(`${OUT}/03_source.sql`, ingest.sources.map((s) => `INSERT OR REPLACE INTO source(source_id,name,abbrev,url,license,attribution,retrieved) VALUES('${esc(s.id)}','${esc(s.name)}','${esc(s.abbrev)}','${esc(s.url)}','${esc(s.license)}','${esc(s.attr)}',NULL);`).join('\n') + '\n');
  files.push(`${OUT}/03_source.sql`);
  writeChunks('xref', 'INSERT OR REPLACE INTO xref(node_id,scheme,value,uri,relation,match_confidence,match_method,source_id)', ingest.xrefs, (x) =>
    `(${q(x.nodeId)},'${x.scheme}',${q(x.value)},${q(x.uri)},${q(x.relation)},${x.conf ?? 'NULL'},${q(x.method)},${q(x.sourceId)})`, 80);
  writeChunks('nsource', 'INSERT OR REPLACE INTO node_source(node_id,source_id,src_ref,src_label,confidence)', ingest.nodeSources, (s) =>
    `(${q(s.nodeId)},${q(s.sourceId)},${q(s.ref)},${q(s.label)},${s.conf ?? 'NULL'})`, 100);
  writeChunks('form', 'INSERT INTO node_form(node_id,lang,form,translit,strongs,source_id)', ingest.forms, (f) =>
    `(${q(f.nodeId)},'${f.lang}',${q(f.form)},${q(f.translit)},${q(f.strongs)},${q(f.sourceId)})`, 100);

  writeFileSync(`${OUT}/manifest.json`, JSON.stringify({ files: files.map((f) => f.replace(OUT + '/', '')), counts: { classes: CLASSES.length, props: PROPS.length, nodes: nodes.length, edges: edges.length, nodeVerse: nodeVerse.length, closure: closure.length, scores: scoreRows.length, enriched, sources: ingest.sources.length, xrefs: ingest.xrefs.length, nodeSources: ingest.nodeSources.length, forms: ingest.forms.length } }, null, 2));
  const byKind = nodes.reduce((a, n) => ((a[n.kind] = (a[n.kind] ?? 0) + 1), a), {});
  console.log('classes', CLASSES.length, '| props', PROPS.length);
  console.log('nodes', nodes.length, JSON.stringify(byKind));
  console.log('edges', edges.length, '| node_verse', nodeVerse.length, '| sql files', files.length);
}
main();
