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
import { ingestSources, ingestInteractions, ingestMacula, ingestPlans, ingestMovements, ingestChurches, ingestRelationships } from './ingest-sources.mjs';

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
// All dates are scholarly estimates (the Bible states no calendar dates) — mark them "c." (circa).
const circa = (y) => (y == null ? null : `c. ${Math.abs(y)} ${y < 0 ? 'BC' : 'AD'}`);
const lifespan = (b, d) => { b = yr(b); d = yr(d); if (b == null && d == null) return null; const era = (d ?? b) < 0 ? ' BC' : ' AD'; return 'c. ' + [b != null ? Math.abs(b) : null, d != null ? Math.abs(d) : null].filter((x) => x != null).join('–') + era; };
const slugify = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
// "also known as": distinct name forms (label + canonical-slug name so "Peter" finds the node
// labelled "Simon" + curated alternate names). Stored pipe-separated so it's both LIKE-searchable
// (SQLite LIKE is case-insensitive) AND displayable as an alias list in the explorer.
const AKA_EXTRA = {
  israel_682: ['Jacob'], peter_2745: ['Cephas', 'Simon Peter'], jesus_905: ['Christ', 'Messiah', 'Jesus of Nazareth'],
  saul_2478: ['King Saul'], paul_2331: ['Saul of Tarsus'], abraham_58: ['Abram'], sarah_60: ['Sarai'],
  'nation-of-israel': ['Israel', 'House of Israel'],
};
// Curated epithets for namesakes of famous figures (a scriptural by-name), so an obscure same-name
// person reads clearly instead of looking like a duplicate. Used as the disambiguator + an alias.
const PERSON_EPITHET = {
  jesus_904: 'called Justus', // "Jesus, who is called Justus" — Paul's fellow worker, Col 4:11
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
const MORAL_FINE = { Jesus: 1.0, 'Judas': -0.95, Herod: -0.85, Cain: -0.85, Jezebel: -0.85, Pharaoh: -0.8, Ahab: -0.75, Jeroboam: -0.7, Saul: -0.45, Solomon: 0.35, David: 0.45, Abraham: 0.85, Moses: 0.85, Noah: 0.85, Paul: 0.85, Mary: 0.9, Stephen: 0.85, Ruth: 0.85, Daniel: 0.85, Joseph: 0.8, Esther: 0.8 };
// WISDOM / discernment signal (wise ↔ foolish) — a trust dimension distinct from moral alignment:
// someone can be wise but wicked, or righteous but rash. [value -1..1, basis, verse].
const WISDOM = {
  Jesus: [1.0, 'in whom are hidden all the treasures of wisdom and knowledge', 'Col.2.3'],
  Solomon: [0.95, 'asked God for a discerning heart; wisdom surpassing all', '1Kgs.3.12'],
  Daniel: [0.9, 'ten times wiser; interpreted dreams and counselled kings', 'Dan.1.20'],
  Joseph: [0.88, 'no one so discerning and wise; set over Egypt', 'Gen.41.39'],
  Abigail: [0.82, 'a woman of good understanding; averted bloodshed', '1Sam.25.3'],
  Job: [0.72, '"the fear of the Lord, that is wisdom"', 'Job.28.28'],
  Jethro: [0.7, 'wise counsel to delegate judging', 'Exod.18.19'],
  Paul: [0.78, 'wrote "according to the wisdom given him"', '2Pet.3.15'],
  Stephen: [0.72, 'they could not resist his wisdom and the Spirit', 'Acts.6.10'],
  Ahithophel: [0.55, 'counsel esteemed as an oracle of God — yet turned traitor', '2Sam.16.23'],
  Samson: [-0.35, 'gifted in strength but rash and undiscerning', 'Judg.16.17'],
  Rehoboam: [-0.6, 'forsook the elders’ counsel for the young men’s folly', '1Kgs.12.8'],
  Nabal: [-0.75, 'a fool; "folly is with him" (his name means fool)', '1Sam.25.25'],
};
// FAITHFULNESS / covenant loyalty (faithful ↔ faithless)
const FAITHFULNESS = {
  Jesus: [1.0, 'called Faithful and True', 'Rev.19.11'], Abraham: [0.9, 'believed God; counted as righteousness', 'Gen.15.6'],
  Ruth: [0.92, '"where you go I will go" — covenant loyalty', 'Ruth.1.16'], Joseph: [0.85, 'kept faith in slavery and prison', 'Gen.39.9'],
  Daniel: [0.9, 'prayed faithfully despite the decree', 'Dan.6.10'], Moses: [0.85, 'faithful in all God’s house', 'Heb.3.5'],
  Caleb: [0.9, 'wholly followed the LORD', 'Num.14.24'], David: [0.7, 'a man after God’s own heart, though he stumbled', 'Acts.13.22'],
  'Judas': [-0.95, 'betrayed the Son of Man', 'Luke.22.48'], Saul: [-0.5, 'rejected for disobedience', '1Sam.15.23'],
  Demas: [-0.6, 'deserted Paul, in love with this world', '2Tim.4.10'], Solomon: [-0.3, 'his heart turned after other gods', '1Kgs.11.4'],
};
// COURAGE / boldness (0..1)
const COURAGE = {
  David: [0.9, 'faced Goliath in the name of the LORD', '1Sam.17.45'], Joshua: [0.9, '"be strong and courageous"', 'Josh.1.9'],
  Daniel: [0.85, 'faced the lions’ den', 'Dan.6.16'], Esther: [0.88, '"if I perish, I perish"', 'Esth.4.16'],
  Stephen: [0.85, 'bold witness unto death', 'Acts.7.51'], Paul: [0.85, 'bold before kings and mobs', 'Acts.20.24'],
  Elijah: [0.85, 'confronted Ahab and the prophets of Baal', '1Kgs.18.21'], Nehemiah: [0.8, 'rebuilt the wall amid threats', 'Neh.6.11'],
  Gideon: [0.5, 'timid, then led the 300', 'Judg.7.7'], Peter: [0.6, 'bold and faltering by turns', 'Acts.4.13'],
};
// TRUTHFULNESS / communication reliability (truthful ↔ deceptive)
const TRUTHFULNESS = {
  Jesus: [1.0, '"I am the way, the truth, and the life"', 'John.14.6'], Nathan: [0.9, 'truthful prophetic rebuke of David', '2Sam.12.7'],
  Samuel: [0.9, 'none of his words fell to the ground', '1Sam.3.19'], Micaiah: [0.88, 'spoke truth against 400 prophets', '1Kgs.22.14'],
  Elijah: [0.85, 'true prophet of the LORD', '1Kgs.17.1'], Daniel: [0.85, 'reliable interpreter of dreams', 'Dan.2.47'],
  Gehazi: [-0.7, 'lied to Elisha for gain', '2Kgs.5.25'], Jacob: [-0.3, 'deceived Isaac for the blessing', 'Gen.27.19'],
  Ananias: [-0.8, 'lied to the Holy Spirit', 'Acts.5.3'], Jezebel: [-0.7, 'false letters to kill Naboth', '1Kgs.21.9'],
};
// REPENTANCE / teachability (repentant ↔ hard-hearted)
const REPENTANCE = {
  David: [0.9, '"I have sinned against the LORD" — Psalm 51', '2Sam.12.13'], Peter: [0.85, 'wept bitterly, then restored', 'Luke.22.62'],
  Manasseh: [0.75, 'humbled himself greatly before God', '2Chr.33.12'], Josiah: [0.8, 'tore his clothes and sought the LORD', '2Kgs.22.19'],
  Zacchaeus: [0.8, 'restored fourfold', 'Luke.19.8'], Jonah: [0.5, 'obeyed at last, but resented mercy', 'Jonah.3.3'],
  Pharaoh: [-0.8, 'hardened his heart repeatedly', 'Exod.8.32'], Saul: [-0.5, 'made excuses rather than repent', '1Sam.15.21'],
  Cain: [-0.6, 'unrepentant after his sin', 'Gen.4.9'], 'Judas': [-0.5, 'remorse without restoration', 'Matt.27.5'],
};
// every curated trust dimension → [score key, data map, signal class, UI label]
const CURATED_DIMS = [
  ['wisdom', WISDOM, 'gc:WisdomSignal'], ['faithfulness', FAITHFULNESS, 'gc:FaithfulnessSignal'],
  ['courage', COURAGE, 'gc:CourageSignal'], ['truthfulness', TRUTHFULNESS, 'gc:TruthfulnessSignal'],
  ['repentance', REPENTANCE, 'gc:RepentanceSignal'],
];
// ACTION signals — specific deeds attributed to an agent [name, deed, polarity +/-/~, verse].
const ACTIONS = [
  ['Jesus', 'raised Lazarus from the dead', '+', 'John.11.43'], ['Jesus', 'washed the disciples’ feet', '+', 'John.13.5'],
  ['Jesus', 'fed the five thousand', '+', 'Matt.14.20'], ['Jesus', 'calmed the storm', '+', 'Mark.4.39'],
  ['Jesus', 'cleansed the temple', '+', 'John.2.15'], ['Jesus', 'healed a leper', '+', 'Matt.8.3'],
  ['Jesus', 'forgave the sinful woman', '+', 'Luke.7.48'], ['Jesus', 'laid down his life on the cross', '+', 'John.19.30'],
  ['Jesus', 'rose from the dead', '+', 'Matt.28.6'],
  ['Judas', 'betrayed Jesus with a kiss', '-', 'Luke.22.48'], ['Judas', 'sold Jesus for thirty pieces of silver', '-', 'Matt.26.15'],
  ['Peter', 'walked on the water toward Jesus', '+', 'Matt.14.29'], ['Peter', 'confessed "You are the Christ"', '+', 'Matt.16.16'],
  ['Peter', 'denied Jesus three times', '-', 'Luke.22.60'],
  ['David', 'killed Goliath', '+', '1Sam.17.50'], ['David', 'spared Saul’s life in the cave', '+', '1Sam.24.7'],
  ['David', 'took Bathsheba and had Uriah killed', '-', '2Sam.11.15'],
  ['Moses', 'stretched his hand over the Red Sea', '+', 'Exod.14.21'], ['Moses', 'struck the rock in anger', '-', 'Num.20.11'],
  ['Abraham', 'offered Isaac in obedience', '+', 'Gen.22.10'], ['Cain', 'murdered his brother Abel', '-', 'Gen.4.8'],
  ['Stephen', 'forgave those stoning him', '+', 'Acts.7.60'], ['Joseph', 'forgave his brothers', '+', 'Gen.45.4'],
  ['Elijah', 'raised the widow’s son', '+', '1Kgs.17.22'], ['Elijah', 'called down fire on Carmel', '+', '1Kgs.18.38'],
  ['Noah', 'built the ark as commanded', '+', 'Gen.6.22'], ['Daniel', 'prayed despite the decree', '+', 'Dan.6.10'],
  ['Ruth', 'gleaned to provide for Naomi', '+', 'Ruth.2.2'], ['Paul', 'persecuted the church before conversion', '-', 'Acts.8.3'],
];
// historical_trust (extra-biblical corroboration, 0..1) — by entity name, attached only where a node exists.
const HISTORICAL = {
  // people with epigraphic / archaeological attestation
  David: [0.7, 'Tel Dan Stele — “House of David” (9th c. BC)'], Ahab: [0.9, 'Kurkh Monolith of Shalmaneser III'], Jehu: [0.95, 'Black Obelisk of Shalmaneser III'], Omri: [0.9, 'Mesha (Moabite) Stele'], Hezekiah: [0.95, 'Siloam inscription + LMLK + royal bullae'], 'Pontius Pilate': [0.95, 'Pilate Stone, Caesarea (1961)'], Caiaphas: [0.85, 'Caiaphas ossuary, Jerusalem (1990)'], Herod: [0.95, 'Herodium + extensive building archaeology'], Sennacherib: [1.0, 'Annals / Taylor Prism, Lachish reliefs'], Nebuchadnezzar: [1.0, 'Babylonian Chronicles + brick stamps'], Cyrus: [1.0, 'Cyrus Cylinder'], Solomon: [0.4, 'monumental gates debated (Megiddo/Gezer/Hazor)'], Jesus: [0.7, 'Tacitus, Annals 15.44; Josephus'], Paul: [0.5, 'Gallio inscription at Delphi anchors the date'],
  // places — well-excavated sites
  Jerusalem: [1.0, 'continuously excavated capital'], Babylon: [1.0, 'excavated Neo-Babylonian capital'], Nineveh: [1.0, 'excavated Assyrian capital'], Damascus: [0.95, 'continuously inhabited city'], Rome: [1.0, 'imperial capital'], Jericho: [0.9, 'Tell es-Sultan excavations'], Samaria: [0.9, 'Omride palace + Samaria ostraca'], Hebron: [0.85, 'Bronze/Iron Age tell'], Bethlehem: [0.75, 'Iron Age settlement; bulla'], Nazareth: [0.7, 'Roman-era village remains'], Capernaum: [0.9, 'excavated synagogue + house of Peter'], Babylonia: [1.0, 'Neo-Babylonian records'],
};
const POLVAL = { positive: 1, negative: -1, mixed: 0 };
// classify a biblical event into the deeper GCO behaviour taxonomy by its title
const EVENT_GC = [
  [/heal|cured|leper|sick|restored sight|made well/i, 'gc:Healing'], [/cast out|demon|unclean spirit|exorc|possess/i, 'gc:Exorcism'],
  [/feeding|fed the|loaves|manna|water from the rock|provide/i, 'gc:Provision'], [/rais(ed|ing)|raised to life|resurrect|came to life/i, 'gc:Raising'],
  [/baptiz|baptism/i, 'gc:Baptism'], [/anoint/i, 'gc:Anointing'], [/circumcis/i, 'gc:Circumcision'],
  [/sacrifice|offering|burnt offering|passover|altar/i, 'gc:Sacrifice'], [/feast|festival|tabernacles|pentecost|unleavened/i, 'gc:Feast'], [/\bpray|prayer/i, 'gc:PrayerAct'],
  [/covenant/i, 'gc:CovenantAct'], [/call(ed|ing)|commission|chose|appoint|ordain/i, 'gc:Calling'], [/\bsent\b|sending|missionary journey/i, 'gc:Sending'],
  [/battle|\bwar\b|fought|defeat|conquest|siege|slew|struck down/i, 'gc:Battle'], [/journey|exodus|wander|travel|voyage|set out|departed/i, 'gc:Journey'],
  [/vision|dream|revelation|appeared|transfigur/i, 'gc:Vision'], [/judgment|plague|punish|wrath|flood|destroy/i, 'gc:Judgment'], [/deliver|rescue|saved|salvation|freed/i, 'gc:Deliverance'],
  [/teach|sermon|parable|preach|spoke to the crowd/i, 'gc:TeachingAct'], [/repent|convert|conversion/i, 'gc:Conversion'], [/\bsin\b|transgress|golden calf|idolat|rebell|disobey/i, 'gc:Transgression'],
  [/\bbirth\b|\bborn\b|nativity/i, 'gc:Birth'], [/death|died|martyr|stoned|crucif|killed/i, 'gc:Death'], [/miracle|\bsign\b|wonder|turned water/i, 'gc:Miracle'],
];
const classifyEventGc = (title) => { for (const [re, c] of EVENT_GC) if (re.test(title || '')) return c; return 'gc:BiblicalEvent'; };
// Approximate lifespans (scholarly estimates) for key figures Theographic leaves undated — chiefly
// the New Testament generation, so "people from Jesus' time" appear on the timeline. Applied only
// where the node has no date; resolved to the most-attested node of that name.
const FLOR_DATES = {
  Peter: [1, 64], Paul: [5, 67], John: [6, 100], James: [1, 62], Andrew: [5, 60], Matthew: [5, 74], Thomas: [1, 72],
  Philip: [5, 80], Bartholomew: [1, 70], Stephen: [1, 34], Barnabas: [1, 61], Timotheus: [17, 97], Titus: [10, 105],
  'Mary, mother of Jesus': [-18, 48], Mary: [-18, 48], Caiaphas: [-14, 46], 'Judas': [1, 33], Judas: [1, 33],
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
  ['gc:House', 'House / Lineage', 'gc', 'org:OrganizationalUnit'], ['gc:Genealogy', 'Genealogy / Ancestral Line', 'gc', 'gc:House'], ['gc:ApostolicBody', 'Apostolic Body', 'gc', 'gc:AgentiveEkklesia'],
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
  // ── Global Church Ontology: deeper biblical-behaviour taxonomy (events / acts) ──
  ['gc:Miracle', 'Miracle', 'gc', 'gc:BiblicalEvent'], ['gc:Healing', 'Healing', 'gc', 'gc:Miracle'], ['gc:Exorcism', 'Exorcism', 'gc', 'gc:Miracle'], ['gc:Provision', 'Provision / Feeding', 'gc', 'gc:Miracle'], ['gc:Raising', 'Raising the dead', 'gc', 'gc:Miracle'],
  ['gc:WorshipAct', 'Worship', 'gc', 'gc:BiblicalEvent'], ['gc:Sacrifice', 'Sacrifice / Offering', 'gc', 'gc:WorshipAct'], ['gc:PrayerAct', 'Prayer', 'gc', 'gc:WorshipAct'], ['gc:Feast', 'Feast / Festival', 'gc', 'gc:WorshipAct'],
  ['gc:CovenantAct', 'Covenant Act', 'gc', 'gc:BiblicalEvent'], ['gc:Baptism', 'Baptism', 'gc', 'gc:CovenantAct'], ['gc:Anointing', 'Anointing', 'gc', 'gc:CovenantAct'], ['gc:Circumcision', 'Circumcision', 'gc', 'gc:CovenantAct'],
  ['gc:Calling', 'Calling / Commissioning', 'gc', 'gc:BiblicalEvent'], ['gc:Appointment', 'Appointment / Ordination', 'gc', 'gc:Calling'], ['gc:Sending', 'Sending / Mission', 'gc', 'gc:Calling'], ['gc:ChurchPlanting', 'Church Planting', 'gc', 'gc:Sending'],
  ['gc:Judgment', 'Judgment', 'gc', 'gc:BiblicalEvent'], ['gc:Deliverance', 'Deliverance / Salvation', 'gc', 'gc:BiblicalEvent'], ['gc:Battle', 'Battle / Conflict', 'gc', 'gc:BiblicalEvent'], ['gc:Journey', 'Journey / Migration', 'gc', 'gc:BiblicalEvent'],
  ['gc:Vision', 'Vision / Revelation', 'gc', 'gc:BiblicalEvent'], ['gc:TeachingAct', 'Teaching', 'gc', 'gc:BiblicalEvent'], ['gc:Conversion', 'Conversion / Repentance', 'gc', 'gc:BiblicalEvent'], ['gc:Transgression', 'Sin / Transgression', 'gc', 'gc:BiblicalEvent'],
  ['gc:Birth', 'Birth', 'gc', 'gc:BiblicalEvent'], ['gc:Death', 'Death', 'gc', 'gc:BiblicalEvent'], ['gc:Martyrdom', 'Martyrdom', 'gc', 'gc:Death'],
  // biblical speech behaviours (extend the illocutionary taxonomy)
  ['gc:Prophecy', 'Prophecy', 'gc', 'gc:Assertive'], ['gc:Parable', 'Parable', 'gc', 'gc:Assertive'], ['gc:Confession', 'Confession', 'gc', 'gc:Assertive'],
  ['gc:Curse', 'Curse', 'gc', 'gc:Expressive'], ['gc:Praise', 'Praise', 'gc', 'gc:Expressive'], ['gc:Vow', 'Vow', 'gc', 'gc:Commissive'],
  // grouped biblical roles (cleaner GCO tree)
  ['gc:Role', 'Biblical Role', 'gc', 'org:Role'],
  ['gc:Place', 'Biblical Place', 'gc', 'geo:Feature'], ['gc:Responsibility', 'Responsibility', 'gc', 'dul:Concept'],
  // gc roles (Bible usage)
  ...[['Patriarch'], ['Matriarch'], ['Prophet'], ['Prophetess'], ['Priest'], ['HighPriest', 'High Priest'], ['King'], ['Queen'], ['Judge'], ['Apostle'], ['Disciple'], ['Levite'], ['Elder'], ['Deacon'], ['Evangelist'], ['Leader'], ['Governor'], ['Scribe'], ['Shepherd'], ['Messiah']].map(([r, l]) => [`gc:${r}`, l ?? r, 'gc', 'gc:Role']),
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
  ['gc:hasRelative', 'has relative', 'gc', 'gc:Person', 'gc:Person', 'gc:hasRelative'],   // kinship (cousin, nephew, …)
  ['gc:companionOf', 'companion of', 'gc', 'prov:Agent', 'prov:Agent', 'gc:companionOf'], // fellow worker / traveller / prisoner
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
  ['Jezebel', '-', 'idolatry + murder'], ['Jeroboam', '-', 'led Israel into sin'], ['Judas', '-', 'betrayed Jesus'],
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
  if (/(Line|Genealogy|Ancestry) of/i.test(name)) return ['gc:Genealogy', 'org:OrganizationalUnit', null];
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
    addNode({ id: p.id, canonId: f.personLookup ?? f.slug, label: f.name ?? 'Person', kind: 'person', disambig: f.gender ?? null, prov: 'prov:Person', dul: 'dul:Person', gc: 'gc:Person', aps: null, authority: f.dictionaryLink ?? null, tStart: yr(f.birthYear), tEnd: yr(f.deathYear), extra: { gender: f.gender, birthYear: f.birthYear, deathYear: f.deathYear } });
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
    addNode({ id: e.id, canonId: `${slugify(f.title)}_${e.id.slice(-4)}`, label: f.title ?? 'Event', kind: 'event', disambig: null, prov: 'prov:Activity', dul: 'dul:Event', gc: classifyEventGc(f.title), aps: null, tStart: yr(f.startDate), tEnd: null, extra: { startDate: f.startDate, duration: f.duration } });
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

  // (No fabricated floruit dates — only dates derived from the Theographic dataset are kept, and all
  //  are labelled as scholarly estimates. The Bible states no calendar dates.)

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
  if (ingest.stats.openbible.merged) console.log('ingest · openbible geo-merged (de-duplicated)', ingest.stats.openbible.merged, 'places');

  // General place de-duplication (all sources): merge place records that share a core name AND sit at
  // the same location (≤ MERGE_KM) — the same place from Theographic + TIPNR + OpenBible or with
  // spelling/qualifier variants. Coord-less stubs fold into the biggest cluster. Genuinely different
  // same-name places far apart (Antioch Syria vs Pisidia; the three Dibons) cluster separately and stay.
  {
    const MERGE_KM = 4;
    const haversineKm = (la1, lo1, la2, lo2) => { const R = 6371, t = Math.PI / 180, dLa = (la2 - la1) * t, dLo = (lo2 - lo1) * t; const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * t) * Math.cos(la2 * t) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.min(1, Math.sqrt(a))); };
    const coreOf = (s) => String(s || '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/\b\d+\b/g, ' ').replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
    const vCount = new Map();
    for (const nv of nodeVerse) vCount.set(nv.id, (vCount.get(nv.id) ?? 0) + 1);
    const score = (n) => (vCount.get(n.id) ?? 0) * 10 + ((n.origin ?? 'theographic') === 'theographic' ? 5 : n.origin === 'openbible' ? 2 : 0);
    const byCore = new Map();
    for (const n of byId.values()) if (n.kind === 'place') { const k = coreOf(n.label); if (k) { if (!byCore.has(k)) byCore.set(k, []); byCore.get(k).push(n); } }
    const remap = new Map();
    for (const group of byCore.values()) {
      if (group.length < 2) continue;
      const coords = group.filter((n) => n.lat != null), none = group.filter((n) => n.lat == null);
      const clusters = [];
      for (const n of coords) { const cl = clusters.find((c) => c.some((m) => haversineKm(n.lat, n.lon, m.lat, m.lon) <= MERGE_KM)); if (cl) cl.push(n); else clusters.push([n]); }
      let biggest = null;
      for (const cl of clusters) {
        const canon = cl.slice().sort((a, b) => score(b) - score(a))[0];
        for (const m of cl) if (m.id !== canon.id) remap.set(m.id, canon.id);
        if (!biggest || cl.length > biggest.cl.length || score(canon) > score(biggest.canon)) biggest = { cl, canon };
      }
      if (biggest) for (const n of none) remap.set(n.id, biggest.canon.id);
    }
    if (remap.size) {
      const resolve = (id) => { let x = id; const seen = new Set(); while (remap.has(x) && !seen.has(x)) { seen.add(x); x = remap.get(x); } return x; };
      for (const e of edges) { if (remap.has(e.src)) e.src = resolve(e.src); if (remap.has(e.dst)) e.dst = resolve(e.dst); }
      for (const nv of nodeVerse) if (remap.has(nv.id)) nv.id = resolve(nv.id);
      for (const x of ingest.xrefs) if (remap.has(x.nodeId)) x.nodeId = resolve(x.nodeId);
      for (const ns of ingest.nodeSources) if (remap.has(ns.nodeId)) ns.nodeId = resolve(ns.nodeId);
      for (const f of ingest.forms) if (remap.has(f.nodeId)) f.nodeId = resolve(f.nodeId);
      for (const id of remap.keys()) byId.delete(id);
      const keep = nodes.filter((n) => !remap.has(n.id)); nodes.length = 0; nodes.push(...keep);
      const eseen = new Set(), ne = edges.filter((e) => { const k = `${e.src}|${e.rel}|${e.dst}|${e.ctx ?? ''}`; if (eseen.has(k)) return false; eseen.add(k); return true; });
      edges.length = 0; edges.push(...ne);
      const vseen = new Set(), nv2 = nodeVerse.filter((v) => { const k = `${v.id}|${v.osis}`; if (vseen.has(k)) return false; vseen.add(k); return true; });
      nodeVerse.length = 0; nodeVerse.push(...nv2);
      console.log('place de-dup · merged', remap.size, 'duplicate place records (all sources) into canonical places');
    }
  }

  // Canonical places: distinguish same-named places that sit in different locations by region
  // (e.g. "Dibon" in Moab vs the one in Judah). Rough lat/lon boxes for the biblical world.
  const REGIONS = [
    ['Egypt', 22, 31.6, 24, 34], ['Sinai', 27.5, 30.4, 32, 35], ['Arabia', 15, 30, 35, 50],
    ['the Negev', 30, 31.25, 34.2, 35.5], ['Philistia', 31.25, 31.85, 34.2, 34.8], ['Judah', 31.25, 31.95, 34.8, 35.5],
    ['Moab', 30.8, 31.95, 35.5, 36.1], ['Edom', 29.8, 30.9, 34.8, 36.2], ['Ammon', 31.7, 32.4, 35.6, 36.3],
    ['Samaria', 31.85, 32.6, 34.9, 35.65], ['Gilead', 32, 33.2, 35.6, 36.5], ['Galilee', 32.55, 33.35, 34.95, 35.75],
    ['Phoenicia', 33, 34.7, 35.0, 35.8], ['Aram (Syria)', 33, 35.5, 35.9, 38.5], ['Cyprus', 34.4, 35.8, 32, 34.7],
    ['Mesopotamia', 29, 38, 38.5, 49], ['Asia Minor', 35.8, 42, 26, 40.5], ['Greece', 34.8, 41.5, 19, 26.5], ['Italy', 37, 46, 7, 19],
  ];
  const classifyRegion = (lat, lon) => { for (const [name, la0, la1, lo0, lo1] of REGIONS) if (lat >= la0 && lat <= la1 && lon >= lo0 && lon <= lo1) return name; return null; };
  {
    const byLabel = new Map();
    for (const n of byId.values()) if (n.kind === 'place' && n.label) { const k = String(n.label).toLowerCase(); if (!byLabel.has(k)) byLabel.set(k, []); byLabel.get(k).push(n); }
    let tagged = 0;
    for (const group of byLabel.values()) {
      if (group.length < 2) continue;                       // only disambiguate genuine same-name collisions
      for (const n of group) {
        if (n.lat == null) continue;
        const r = classifyRegion(n.lat, n.lon);
        if (r) { const ex = n.disambig && /^[A-Za-z/() ]+$/.test(n.disambig) ? ' · ' + n.disambig : ''; n.disambig = r + ex; tagged++; }
      }
    }
    console.log('place de-dup · region-disambiguated', tagged, 'same-named places');
  }

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

  // interpersonal relationships beyond family — kinship + companionship (with scripture)
  const rel = ingestRelationships({ ROOT, byId, addEdge, peopleByKey, norm });
  console.log('relationships · kinship', rel.kinship, '· companion', rel.companion);

  // Relative dating — a person with no dates of their own but a dated relative or a dated event
  // they took part in gets an approximate year (marked 'relative' → shown as a triangle, not a bar).
  {
    const adj = new Map();
    const link = (a, b) => { if (!adj.has(a)) adj.set(a, []); adj.get(a).push(b); };
    for (const e of edges) {
      if (/hasParent|hasChild|hasSibling|hasPartner|hasRelative|wasAssociatedWith|participatedIn|spokeTo|bornAt|diedAt/.test(e.rel)) { link(e.src, e.dst); link(e.dst, e.src); }
    }
    let inferred = 0;
    for (const n of byId.values()) {
      if (n.kind !== 'person' || n.tStart != null) continue;
      for (const nb of adj.get(n.id) ?? []) { const nd = byId.get(nb); if (nd && nd.tStart != null) { n.tStart = nd.tStart; n.extra = { ...n.extra, dateBasis: 'relative' }; inferred++; break; } }
    }
    console.log('relative dating · inferred', inferred, 'people from dated kin/events');
  }

  // Disambiguate same-named events by their location (Theographic reuses titles like "Resurrection
  // and Ascension" for records at different places) — append the place to the label so they differ.
  {
    const evLoc = new Map();
    for (const e of edges) if (e.rel === 'dul:hasLocation') { const s = byId.get(e.src); if (s && s.kind === 'event' && !evLoc.has(e.src)) { const p = byId.get(e.dst); if (p) evLoc.set(e.src, p.label); } }
    const byLabel = new Map();
    for (const n of byId.values()) if (n.kind === 'event' && n.label) { const k = n.label.toLowerCase(); if (!byLabel.has(k)) byLabel.set(k, []); byLabel.get(k).push(n); }
    let adj = 0;
    for (const group of byLabel.values()) {
      if (group.length < 2) continue;
      const seen = new Set(); let i = 0;
      for (const n of group) { i++; const loc = evLoc.get(n.id); let suffix = loc && !seen.has(loc.toLowerCase()) ? loc : null; if (suffix) seen.add(suffix.toLowerCase()); else if (i > 1) suffix = `#${i}`; if (suffix) { n.label = `${n.label} · ${suffix}`; adj++; } }
    }
    console.log('event de-dup · disambiguated', adj, 'same-named events by location');
  }

  // Disambiguate same-named PEOPLE (e.g. 3 distinct "Hezekiah"s: son of Ahaz the king, son of
  // Neariah, son of Ater). These are different biblical people who share a name — not duplicates —
  // so we tag each with role + parentage ("King · son of Ahaz") to tell them apart.
  {
    // gather whatever relational context we have for each person, in priority order
    const parentOf = new Map(), spouseOf = new Map(), childOf = new Map(), sibOf = new Map(), placeOf = new Map();
    const lab = (id) => byId.get(id)?.label;
    for (const e of edges) {
      if (e.rel === 'gc:hasParent' && !parentOf.has(e.src)) parentOf.set(e.src, lab(e.dst));
      else if (e.rel === 'gc:hasPartner' && !spouseOf.has(e.src)) spouseOf.set(e.src, lab(e.dst));
      else if (e.rel === 'gc:hasChild' && !childOf.has(e.src)) childOf.set(e.src, lab(e.dst));
      else if (e.rel === 'gc:hasSibling' && !sibOf.has(e.src)) sibOf.set(e.src, lab(e.dst));
      else if (e.rel === 'gc:bornAt' && !placeOf.has(e.src)) placeOf.set(e.src, lab(e.dst));
    }
    const vCount = new Map(), firstOsis = new Map();
    for (const nv of nodeVerse) { vCount.set(nv.id, (vCount.get(nv.id) ?? 0) + 1); if (!firstOsis.has(nv.id)) firstOsis.set(nv.id, nv.osis); }
    const prettyRef = (o) => String(o).replace(/\.(\d+)$/, ':$1').replace('.', ' ');
    const byLabel = new Map();
    for (const n of byId.values()) if (n.kind === 'person' && n.label) { const k = n.label.toLowerCase(); if (!byLabel.has(k)) byLabel.set(k, []); byLabel.get(k).push(n); }
    let tagged = 0;
    for (const group of byLabel.values()) {
      if (group.length < 2) continue;
      group.sort((a, b) => (vCount.get(b.id) ?? 0) - (vCount.get(a.id) ?? 0));  // most-attested first
      for (const n of group) {
        const g = n.extra?.gender, F = g === 'Female';
        const parts0 = String(n.disambig ?? '').split(' · ');
        const role = parts0[0] && !/^(Male|Female)$/.test(parts0[0]) ? parts0[0] : null;
        const fa = parentOf.get(n.id), sp = spouseOf.get(n.id), ch = childOf.get(n.id), sb = sibOf.get(n.id), pl = placeOf.get(n.id);
        // whatever context we know, in order: parent → spouse → child → sibling → birthplace
        const ctx = PERSON_EPITHET[n.canonId] || (fa ? `${F ? 'daughter' : 'son'} of ${fa}` : sp ? `${F ? 'wife' : 'husband'} of ${sp}`
          : ch ? `${F ? 'mother' : 'father'} of ${ch}` : sb ? `${F ? 'sister' : 'brother'} of ${sb}`
            : pl ? `of ${pl}` : firstOsis.get(n.id) ? `in ${prettyRef(firstOsis.get(n.id))}` : null);
        const parts = [role, ctx].filter(Boolean);
        if (parts.length) { n.disambig = parts.join(' · '); tagged++; }
      }
    }
    console.log('person de-dup · disambiguated', tagged, 'same-named people (parent/spouse/child/sibling/place)');
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
  // curated character signals (wisdom, faithfulness, courage, truthfulness, repentance) — verse-backed chips
  for (const [dim, map] of CURATED_DIMS) {
    const dlabel = dim[0].toUpperCase() + dim.slice(1);
    for (const [name, [val, basis, osis]] of Object.entries(map)) {
      const id = pickMax(peopleByKey.get(norm(name))) || nameToId.get(name);
      if (id && byId.has(id)) sigRows.push({ id, pol: val >= 0 ? 'positive' : 'negative', basis: `${dlabel} — ${basis}`, osis: osis ?? null });
    }
  }
  // ACTION signals — specific deeds attributed to an agent become trust signals (Jesus raising the
  // dead and washing feet; Judas’ betrayal; Peter’s denial …). Each is a verse-backed gc:*Signal.
  for (const [name, basis, pol, osis] of ACTIONS) {
    const id = pickMax(peopleByKey.get(norm(name))) || nameToId.get(name);
    if (id && byId.has(id)) sigRows.push({ id, pol: pol === '-' ? 'negative' : pol === '~' ? 'mixed' : 'positive', basis: `Act — ${basis}`, osis: osis ?? null });
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
  // curated character dimensions (wisdom, faithfulness, courage, truthfulness, repentance) — each a
  // distinct trust signal: someone can be wise but faithless, courageous but rash, etc.
  for (const [dim, map, sigClass] of CURATED_DIMS) {
    for (const [name, [val, basis]] of Object.entries(map)) {
      const id = pickMax(peopleByKey.get(norm(name))) || nameToId.get(name);
      if (id && byId.has(id)) scoreRows.push({ id, dim, val, basis, method: `curated (${sigClass})` });
    }
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
