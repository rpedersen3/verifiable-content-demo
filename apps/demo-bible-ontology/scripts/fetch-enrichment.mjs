// Refresh the curated Wikidata/Commons enrichment for key Bible entities.
// Resolves each to a Wikidata QID (hard/ambiguous names via en.wikipedia article titles), pulls
// the P18 image + Commons license/author, and writes data/wikidata-enrichment.json — the committed,
// verified source that build-ontology.mjs joins onto nodes (canonical authority + licensed images).
//   node scripts/fetch-enrichment.mjs
const UA={'User-Agent':'verifiable-content-demo/0.1 (richardpedersen3@gmail.com)'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function wd(p){for(let t=0;t<6;t++){const r=await fetch('https://www.wikidata.org/w/api.php?format=json&'+p,{headers:UA});const x=await r.text();if(x.startsWith('You are making')){await sleep(1500*(t+1));continue;}try{return JSON.parse(x);}catch{await sleep(1000);}}return{};}
async function commons(p){for(let t=0;t<6;t++){const r=await fetch('https://commons.wikimedia.org/w/api.php?format=json&'+p,{headers:UA});const x=await r.text();if(x.startsWith('You are making')){await sleep(1500*(t+1));continue;}try{return JSON.parse(x);}catch{await sleep(1000);}}return{};}

// Resolve the 9 hard people via en.wikipedia article titles (accurate sitelink lookup)
const TITLES={Isaac:'Isaac','Joseph':'Joseph (Genesis)',Samuel:'Samuel',Saul:'Saul',
 Daniel:'Daniel (biblical figure)',Deborah:'Deborah',Timothy:'Timothy (biblical figure)',
 Ruth:'Ruth (biblical figure)',Miriam:'Miriam'};
const titleQ={};
{
  const titles=Object.values(TITLES).join('|');
  const d=await wd('action=wbgetentities&sites=enwiki&props=info&titles='+encodeURIComponent(titles));
  for(const[name,title] of Object.entries(TITLES)){
    const ent=Object.values(d.entities||{}).find(e=>e.sitelinks?.enwiki?.title===title || e.labels);
    // map by matching sitelink
    for(const[qid,e] of Object.entries(d.entities||{})){
      if(e.sitelinks?.enwiki?.title===title){titleQ[name]=qid;}
    }
  }
}
// fallback: query each title individually to be safe
for(const[name,title] of Object.entries(TITLES)){
  if(titleQ[name])continue;
  const d=await wd('action=wbgetentities&sites=enwiki&props=sitelinks&titles='+encodeURIComponent(title));await sleep(300);
  const qid=Object.keys(d.entities||{}).find(k=>k.startsWith('Q'));
  if(qid)titleQ[name]=qid;
}
console.error('resolved hard:',JSON.stringify(titleQ));

// Final QID map: name -> QID  (verified across passes)
const PEOPLE={
 Jesus:'Q302',Paul:'Q9200',Moses:'Q9077',Abraham:'Q9181',David:'Q41370',Solomon:'Q37085',
 Adam:'Q70899',Eve:'Q830183',Noah:'Q81422',Aaron:'Q51676',Jacob:'Q289957',Joshua:'Q7734',
 Elijah:'Q133507',Elisha:'Q206238',Isaiah:'Q188794',Jeremiah:'Q158825',Ezekiel:'Q194064',
 Gideon:'Q176125',Samson:'Q214648',Esther:'Q732413',Nehemiah:'Q1025598',Peter:'Q33923',
 John:'Q44015',Andrew:'Q43399',Thomas:'Q43669',Philip:'Q43675',Stephen:'Q161775',Mary:'Q345',
 Sarah:'Q194808',Job:'Q179962',Barnabas:'Q185856',Enoch:'Q213027',Cain:'Q205365',
 Jezebel:'Q721295',Ahab:'Q235901',Jeroboam:'Q313219','Judas Iscariot':'Q81018',Korah:'Q1337316',
 Matthew:'Q43600',James:'Q43999','Herod':'Q51672','Pontius Pilate':'Q17131',Caiaphas:'Q211246',
 'John the Baptist':'Q40662',Rebecca:'Q40520',Rachel:'Q207389',Leah:'Q128847',
 ...Object.fromEntries(Object.entries(titleQ)),
};
const PLACES={Jerusalem:'Q1218',Bethlehem:'Q5776',Nazareth:'Q430776',Babylon:'Q5684',
 'Jordan River':'Q40059','Mount Sinai':'Q377485','Sea of Galilee':'Q126982',Jericho:'Q5687',
 Rome:'Q220',Damascus:'Q3766',Nineveh:'Q5680',Hebron:'Q168225',Bethany:'Q831190',
 Capernaum:'Q59174','Mount of Olives':'Q205976','Garden of Eden':'Q19014','Red Sea':'Q23406',
 Samaria:'Q1757438',Galilee:'Q83241',Judea:'Q104028'};
const EVENTS={Creation:'Q137651',Flood:'Q5532837',Exodus:'Q1290338',Crucifixion:'Q51636',
 Resurrection:'Q51624','Last Supper':'Q51633',Nativity:'Q51628','Tower of Babel':'Q41213'};

const ALL=[...Object.entries(PEOPLE).map(([n,q])=>[n,q,'person']),
 ...Object.entries(PLACES).map(([n,q])=>[n,q,'place']),
 ...Object.entries(EVENTS).map(([n,q])=>[n,q,'event'])];

// fetch labels + P18 in batches of 45
const ent={};
const ids=[...new Set(ALL.map(a=>a[1]))];
for(let i=0;i<ids.length;i+=45){
  const d=await wd('action=wbgetentities&props=labels|descriptions|claims&languages=en&ids='+ids.slice(i,i+45).join('|'));await sleep(400);
  Object.assign(ent,d.entities);
}
// fetch commons license/artist per file
async function fileMeta(file){
  const d=await commons('action=query&prop=imageinfo&iiprop=extmetadata&titles='+encodeURIComponent('File:'+file));await sleep(300);
  const pg=Object.values(d.query?.pages||{})[0];const em=pg?.imageinfo?.[0]?.extmetadata||{};
  const strip=s=>String(s||'').replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim();
  return {license:strip(em.LicenseShortName?.value)||'see Commons',artist:strip(em.Artist?.value).slice(0,80)};
}
const out=[];
for(const[name,qid,kind] of ALL){
  const e=ent[qid];if(!e){console.error('MISSING',name,qid);continue;}
  const label=e.labels?.en?.value;const desc=e.descriptions?.en?.value||'';
  const file=e.claims?.P18?.[0]?.mainsnak?.datavalue?.value||null;
  let meta={license:null,artist:null};
  if(file)meta=await fileMeta(file);
  const thumb=file?'https://commons.wikimedia.org/wiki/Special:FilePath/'+encodeURIComponent(file)+'?width=320':null;
  const full=file?'https://commons.wikimedia.org/wiki/Special:FilePath/'+encodeURIComponent(file):null;
  out.push({name,kind,qid,wikidata:'https://www.wikidata.org/entity/'+qid,label,desc,image:full,thumb,license:meta.license,artist:meta.artist});
  console.error((file?'IMG ':'no  '),(name+'             ').slice(0,16),qid.padEnd(9),(label||'?').slice(0,22).padEnd(22),'| '+(meta.license||''));
}
const url=await import('node:url');const path=await import('node:path');
const here=path.dirname(url.fileURLToPath(import.meta.url));
const outFile=path.join(here,'..','data','wikidata-enrichment.json');
(await import('node:fs')).writeFileSync(outFile,JSON.stringify(out,null,2));
console.error('\nTOTAL',out.length,'| with image',out.filter(o=>o.image).length,'→',outFile);
