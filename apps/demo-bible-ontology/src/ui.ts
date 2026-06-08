// Single-page explorer served by the Worker. Vanilla JS + SVG; talks to /api/*.
export const UI = `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Bible Ontology — PROV-O graph + GCO validation</title>
<style>
:root{--bg:#f6f8fb;--card:#fff;--ink:#1f2733;--muted:#6b7785;--line:#e4e9f0;--accent:#2f6df0;--ok:#1a8a4f;--no:#c0392b;--warn:#b45309;--mono:ui-monospace,Menlo,monospace}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,Segoe UI,Roboto,sans-serif}
.wrap{max-width:1080px;margin:0 auto;padding:24px 20px 64px}
h1{font-size:24px;margin:0}.sub{color:var(--muted);margin:4px 0 18px;font-size:13px}
nav{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:18px}
nav button{background:#eef2fb;color:var(--accent);border:0;border-radius:8px;padding:8px 14px;font:inherit;font-weight:600;cursor:pointer}
nav button.on{background:var(--accent);color:#fff}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px;margin-bottom:14px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.stat{background:#f8fafd;border:1px solid var(--line);border-radius:10px;padding:12px}
.stat .n{font-size:22px;font-weight:700}.stat .l{font-size:12px;color:var(--muted)}
.bar{display:flex;height:26px;border-radius:6px;overflow:hidden;margin:8px 0}
.bar div{display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:600}
input{padding:9px 12px;border:1px solid var(--line);border-radius:8px;font:inherit;width:100%;max-width:420px}
.chip{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:600;margin-right:6px}
.muted{color:var(--muted)}.mono{font-family:var(--mono);font-size:12px}
ul.list{list-style:none;margin:0;padding:0}
ul.list li{padding:8px 6px;border-bottom:1px solid var(--line);cursor:pointer;display:flex;align-items:center;gap:8px}
ul.list li:hover{background:#f8fafd}
.kdot{width:9px;height:9px;border-radius:50%;flex:none}
.edge-grp{margin:8px 0}.edge-grp .rel{font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.03em}
.edge-grp a{color:var(--accent);text-decoration:none;cursor:pointer;margin-right:10px;font-size:13px}
.verses{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
.verses span{font:11px var(--mono);background:#eef2fb;color:#3a4a63;border-radius:4px;padding:1px 6px}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.03em}
.tag-prov{background:#e7f0ff;color:#2f6df0}.tag-dns{background:#fbf0e6;color:#b45309}.tag-un{background:#fdeceA;color:#c0392b}
svg{width:100%;background:#fbfcfe;border:1px solid var(--line);border-radius:10px}
svg#gsvg{height:560px;display:block}
.gnode{cursor:pointer;transition:opacity .12s}.gnode .gnlabel{pointer-events:none;font-weight:500}
.gcluster{cursor:pointer;transition:opacity .12s}
.gedge{transition:opacity .12s}
svg.dim .gedge{opacity:.07}svg.dim .gnode{opacity:.22}svg.dim .gcluster{opacity:.22}
.gedge.hot{opacity:1!important;stroke-width:2.6}.gnode.hot{opacity:1!important}
.gbread{margin:6px 0 2px;font-size:14px}
.gchips{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}
.gchip{font-size:11px;font-weight:600;padding:4px 11px;border-radius:999px;border:1px solid var(--line);color:var(--muted);cursor:pointer;background:#fff;user-select:none}
.gtip{position:fixed;display:none;z-index:30;background:#fff;border:1px solid var(--line);border-radius:8px;padding:8px 11px;font-size:12px;line-height:1.45;box-shadow:0 6px 20px rgba(20,30,50,.16);max-width:230px;pointer-events:none}
.glegend{font-size:11px;color:var(--muted);margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.ghint{font-size:12px;color:var(--muted);margin-top:6px}
.hint{font-size:12px;color:var(--muted);margin:10px 0 0}
a.link{color:var(--accent);cursor:pointer;text-decoration:none}
/* canonical id + authority */
.idrow{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:4px 0 8px}
.idpill{font:12px var(--mono);background:#eef2fb;color:#3a4a63;border-radius:6px;padding:2px 8px}
.confdot{width:9px;height:9px;border-radius:50%;display:inline-block;flex:none;margin-left:auto}
.confchip{font-size:11px;font-weight:700;border-radius:999px;padding:2px 9px;white-space:nowrap}
/* portraits: source (Wikimedia) + consistent app-style render */
.portrait-wrap{display:flex;gap:14px;flex-wrap:wrap;align-items:flex-start;margin:4px 0 12px}
.portrait{width:128px}.portrait figure{margin:0}
.portrait .tag{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);text-align:center;margin-bottom:4px}
.portrait img{width:128px;height:128px;object-fit:cover;border-radius:10px;display:block;border:1px solid var(--line)}
.portrait .frame{border-radius:12px;padding:5px;background:linear-gradient(145deg,#f4e8c8,#c9a13f);box-shadow:0 2px 9px rgba(120,90,20,.25)}
.portrait .frame img{border-radius:7px;border:2px solid #fff}
.portrait.styled img{filter:sepia(.6) saturate(1.25) contrast(1.06) brightness(1.02) hue-rotate(-8deg)}
.portrait figcaption{font-size:10px;color:var(--muted);margin-top:5px;text-align:center;line-height:1.3}
img.mini{width:24px;height:24px;border-radius:50%;object-fit:cover;flex:none;border:1px solid var(--line)}
img.mini.styled{filter:sepia(.6) saturate(1.25) contrast(1.06)}
/* trust/alignment score bars */
.scores{display:grid;grid-template-columns:122px 1fr 50px;gap:7px 10px;align-items:center;margin:10px 0;font-size:12px}
.scores .sname{color:var(--muted)}
.sbar{height:13px;border-radius:7px;background:#eef2f7;position:relative;overflow:hidden}
.sbar i{position:absolute;top:0;bottom:0;display:block;border-radius:7px}
.sbar.bipolar{background:linear-gradient(90deg,#fbe3e3,#fff,#e4f3e8)}
.sbar.bipolar .mid{position:absolute;left:50%;top:-2px;bottom:-2px;width:1px;background:#b8c2cf}
.sval{font:11px var(--mono);text-align:right}
.admin label{display:flex;gap:11px;align-items:flex-start;padding:11px 13px;border:1px solid var(--line);border-radius:9px;margin:7px 0;cursor:pointer}
.admin label.on{border-color:var(--accent);background:#f4f8ff}
/* original-language forms + external ids + provenance */
.forms{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}
.form{border:1px solid var(--line);border-radius:8px;padding:5px 11px;text-align:center}
.form .lng{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.form b{font-size:20px;display:block;line-height:1.3}
.form .st{font:11px var(--mono);color:var(--muted)}
.xrefs{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
a.xref,span.xref{font-size:11px;border-radius:6px;padding:3px 9px;text-decoration:none;border:1px solid var(--line);color:var(--ink);background:#fff}
a.xref:hover{background:#f8fafd}
.prov{font-size:12px;margin-top:10px}
.prov .src{display:inline-block;border:1px solid var(--line);border-radius:6px;padding:2px 8px;margin:2px 5px 2px 0}
.origin{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;border-radius:5px;padding:2px 7px;background:#eef2fb;color:#3a4a63}
</style></head><body><div class="wrap">
<h1>Bible Ontology</h1>
<div class="sub">A PROV-O graph of the Bible (Agent · Activity · Entity) over DUL · W3C ORG · GeoSPARQL · aps:skills · gc:, used to validate the Global Church Ontology. Data: Theographic Bible Metadata (CC-BY-SA).</div>
<nav>
 <button data-t="overview" class="on">Overview</button>
 <button data-t="explore">Explore</button>
 <button data-t="classes">Inheritance</button>
 <button data-t="graph">Trust graph</button>
 <button data-t="validate">Validate GCO</button>
 <button data-t="admin">Admin</button>
</nav>
<div id="view"></div>
</div>
<script>
const KC={person:'#2563eb',organization:'#9333ea',event:'#0e7490',place:'#b45309',role:'#0d9488',skill:'#7c3aed',membership:'#94a0b3',responsibility:'#475569',deity:'#7c3aed',concept:'#64748b'};
const V=document.getElementById('view');
const api=(p)=>fetch('/api'+p).then(r=>r.json());
const esc=(s)=>String(s??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const dot=(k)=>'<span class="kdot" style="background:'+(KC[k]||'#888')+'"></span>';
let tab='overview';

// ── entity portraits: source image + a consistent app-style render; admin-configurable ──
const IMG_KEY='ont.imgMode';
const imgMode=()=>localStorage.getItem(IMG_KEY)||'both';   // 'both' | 'original' | 'styled'
const styledSrc=(n)=>n.image_styled_url||n.image_thumb;     // generative backfill, else CSS-styled source
function portrait(n){
  if(!n||!n.image_thumb)return '';
  const m=imgMode();
  const cap=[n.image_license,n.image_attr].filter(Boolean).map(esc).join(' · ');
  const orig='<div class="portrait"><div class="tag">source</div><figure><img loading="lazy" src="'+esc(n.image_thumb)+'" alt="'+esc(n.label)+'"/><figcaption>'+(cap||'Wikimedia')+'<br>via Wikimedia Commons</figcaption></figure></div>';
  const sty='<div class="portrait styled"><div class="tag">app style</div><figure><div class="frame"><img loading="lazy" src="'+esc(styledSrc(n))+'" alt="'+esc(n.label)+'"/></div><figcaption>consistent render'+(n.image_styled_url?'':' (derived)')+'</figcaption></figure></div>';
  return '<div class="portrait-wrap">'+(m==='original'?orig:m==='styled'?sty:orig+sty)+'</div>';
}
// canonical-id confidence: how sure we are the data on this node is bound to the right canonical id.
const confColors=(v)=>v>=0.9?['#1a8a4f','#e7f6ee']:v>=0.7?['#b45309','#fbf0e6']:['#c0392b','#fdeceA'];
function confBadge(v,method,basis){
  if(v==null)return '';
  const c=confColors(v);const lab=method==='source'?'native id ✓':(v>=0.9?'rock solid':v>=0.7?'review':'suspect');
  return '<span class="confchip" title="canonical-id confidence '+v.toFixed(2)+(basis?' — '+esc(basis):'')+(method?' ['+esc(method)+']':'')+'" style="background:'+c[1]+';color:'+c[0]+'">canon '+v.toFixed(2)+' · '+lab+'</span>';
}
const confDot=(v)=>v==null?'':'<span class="confdot" title="canonical-id confidence '+(+v).toFixed(2)+'" style="background:'+confColors(v)[0]+'"></span>';
function bandChips(integ){
  if(!integ)return '';
  const B=[['native','#1a8a4f','#e7f6ee','native id (1.0)'],['high','#1a8a4f','#e7f6ee','high ≥.90'],['medium','#b45309','#fbf0e6','review .70–.90'],['low','#c0392b','#fdeceA','suspect <.70']];
  return B.filter(b=>integ[b[0]]).map(b=>'<span class="confchip" style="background:'+b[2]+';color:'+b[1]+'">'+integ[b[0]].toLocaleString()+' '+b[3]+'</span>').join(' ');
}
function idrow(n){
  const links=[];
  if(n.wikidata)links.push('<a class="link" href="'+esc(n.wikidata)+'" target="_blank" rel="noopener">Wikidata ↗</a>');
  if(n.authority_uri&&n.authority_uri!==n.wikidata)links.push('<a class="link" href="'+esc(n.authority_uri)+'" target="_blank" rel="noopener">authority ↗</a>');
  const cb=confBadge(n.canon_confidence,n.canon_method,n.canon_basis);
  const og=n.origin_source&&n.origin_source!=='theographic'?'<span class="origin" title="canonical node minted from this source (not in the Theographic backbone)">'+esc(n.origin_source)+'</span>':'';
  if(!n.canon_id&&!n.disambig&&!links.length&&!cb&&!og)return '';
  return '<div class="idrow">'+(n.canon_id?'<span class="idpill" title="canonical id — unique even when names collide">'+esc(n.canon_id)+'</span>':'')+og+(n.disambig?'<span class="muted">'+esc(n.disambig)+'</span>':'')+links.join(' ')+cb+'</div>';
}
// multi-source: original-language forms, external identifiers, provenance
const XSCHEME={wikidata:['Wikidata','#a30000'],pleiades:['Pleiades','#7b3f00'],geonames:['GeoNames','#0b6e4f'],tipnr:['STEPBible','#2f6df0'],strongs:["Strong's",'#6b21a8'],openbible:['OpenBible','#b45309'],theographic:['Theographic','#475569']};
const relColor=(r)=>/exact/.test(r||'')?'#1a8a4f':/close/.test(r||'')?'#b45309':'#94a0b3';
const LANG={hbo:'Hebrew',grc:'Greek',arc:'Aramaic'};
function formsHtml(forms){
  if(!forms||!forms.length)return '';
  const seen=new Set(),items=forms.filter(f=>{const k=f.lang+f.form;if(seen.has(k))return false;seen.add(k);return true;});
  return '<h3 class="muted" style="margin-top:16px">original-language forms <span style="font-weight:400;text-transform:none">· STEPBible TIPNR</span></h3><div class="forms">'+items.map(f=>'<div class="form"><span class="lng">'+(LANG[f.lang]||f.lang)+'</span><b dir="'+(f.lang==='grc'?'ltr':'rtl')+'">'+esc(f.form)+'</b><span class="st">'+esc(f.strongs)+'</span></div>').join('')+'</div>';
}
function xrefsHtml(xrefs){
  if(!xrefs||!xrefs.length)return '';
  const seen=new Set(),items=xrefs.filter(x=>{const k=x.scheme+x.value;if(seen.has(k))return false;seen.add(k);return true;});
  return '<h3 class="muted" style="margin-top:16px">external identifiers</h3><div class="xrefs">'+items.map(x=>{const m=XSCHEME[x.scheme]||[x.scheme,'#475569'];const inner='<b style="color:'+m[1]+'">'+m[0]+'</b> '+esc(x.value)+' <span style="color:'+relColor(x.relation)+'" title="'+esc(x.relation||'')+' · match confidence '+(x.match_confidence??'?')+'">●</span>';return x.uri?'<a class="xref" href="'+esc(x.uri)+'" target="_blank" rel="noopener">'+inner+'</a>':'<span class="xref">'+inner+'</span>';}).join('')+'</div><div class="hint">● <span style="color:#1a8a4f">exact</span> / <span style="color:#b45309">close</span> / <span style="color:#94a0b3">related</span> match — hover for confidence.</div>';
}
function provHtml(sources,origin){
  if((!sources||!sources.length)&&!origin)return '';
  const list=(sources||[]).map(s=>'<span class="src" title="'+esc(s.name)+(s.src_ref?' · '+esc(s.src_ref):'')+(s.confidence!=null?' · attestation '+s.confidence:'')+'"><a class="link" href="'+esc(s.url)+'" target="_blank" rel="noopener">'+esc(s.abbrev||s.source_id)+'</a> <span class="muted">'+esc(s.license||'')+'</span></span>').join('');
  return '<div class="prov"><span class="muted">attested by:</span> '+list+'</div>';
}
const SDIM={moral:'Good ↔ Evil',graph_trust:'Graph trust',scriptural_trust:'Scriptural trust',historical_trust:'Historical trust',source_trust:'Source corroboration'};
const SCOL={graph_trust:'#2563eb',scriptural_trust:'#0e7490',historical_trust:'#b45309',source_trust:'#7c3aed'};
function scoreBars(scores){
  if(!scores||!scores.length)return '';
  const byD={};scores.forEach(s=>byD[s.dimension]=s);
  const rows=['moral','graph_trust','scriptural_trust','historical_trust','source_trust'].filter(d=>byD[d]).map(d=>{const s=byD[d];const v=+s.value;
    const name='<div class="sname" title="'+esc(s.basis||'')+' ('+esc(s.method||'')+')">'+SDIM[d]+'</div>';
    if(d==='moral'){const w=Math.abs(v)/2*100,left=v>=0?50:50-w,col=v>=0?'#1a8a4f':'#c0392b';
      return name+'<div class="sbar bipolar"><span class="mid"></span><i style="left:'+left+'%;width:'+w+'%;background:'+col+'"></i></div><div class="sval" style="color:'+col+'">'+(v>0?'+':'')+v.toFixed(2)+'</div>';}
    return name+'<div class="sbar"><i style="left:0;width:'+Math.round(v*100)+'%;background:'+SCOL[d]+'"></i></div><div class="sval">'+v.toFixed(2)+'</div>';
  }).join('');
  return '<h3 class="muted" style="margin-top:16px">trust &amp; alignment signals</h3><div class="scores">'+rows+'</div>'+
   '<div class="hint">Graph, scriptural &amp; source trust are <b>computed</b> (graph connectivity · verse coverage · independent source assertions agreeing — DOLCE+DnS corroboration); good↔evil &amp; historical trust are <b>curated</b> (Bible signals · archaeology).</div>';
}

document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{tab=b.dataset.t;document.querySelectorAll('nav button').forEach(x=>x.classList.toggle('on',x===b));render();});

async function render(){
  if(tab==='overview')return overview();
  if(tab==='explore')return explore();
  if(tab==='classes')return classes();
  if(tab==='graph')return graph();
  if(tab==='validate')return validate();
  if(tab==='admin')return admin();
}
// ── Inheritance browser: a class + ALL its subclasses across every layer ──
async function classes(){
  V.innerHTML='<div class="card"><h3 class="muted" style="margin-top:0">Ontology inheritance</h3>'+
   '<p class="hint">Pick a class — results include every <b>subclass</b>, across all layers (DUL · PROV-O · W3C ORG · GeoSPARQL · gc:). Asking for <b>prov:Agent</b> returns people <i>and</i> organizations, because the database stores the transitive subclass closure (a query for the parent class resolves all descendants).</p>'+
   '<div class="gchips" id="ccls"></div><div id="cout"></div></div>';
  const picks=['prov:Agent','prov:Activity','prov:Entity','dul:Object','dul:Event','org:Organization','gc:Place','gc:Person','org:Role'];
  document.getElementById('ccls').innerHTML=picks.map(c=>'<span class="gchip" data-c="'+c+'">'+c+'</span>').join('');
  document.querySelectorAll('#ccls [data-c]').forEach(ch=>ch.onclick=()=>{document.querySelectorAll('#ccls [data-c]').forEach(x=>x.classList.toggle('on',x===ch));if(ch.classList.contains('on'))ch.style.cssText='background:var(--accent);color:#fff;border-color:var(--accent)';document.querySelectorAll('#ccls [data-c]').forEach(x=>{if(x!==ch)x.style.cssText=''});classQuery(ch.dataset.c);});
  const first=document.querySelector('#ccls [data-c]');first.classList.add('on');first.style.cssText='background:var(--accent);color:#fff;border-color:var(--accent)';
  classQuery('prov:Agent');
}
async function classQuery(curie){
  const out=document.getElementById('cout');out.innerHTML='<div class="hint">loading…</div>';
  const d=await api('/class?curie='+encodeURIComponent(curie));
  const sm=imgMode()==='styled'?' styled':'';
  out.innerHTML='<div class="hint" style="margin:12px 0"><b style="font-size:15px;color:var(--ink)">'+d.total.toLocaleString()+'</b> instances of <span class="mono">'+esc(curie)+'</span> + its <b>'+d.subclasses.length+'</b> subclasses &nbsp;<span class="mono muted">'+d.subclasses.map(esc).join(' · ')+'</span></div>'+
   '<ul class="list">'+d.results.map(r=>'<li onclick="showNodeTab(\\''+r.id+'\\')">'+(r.image_thumb?'<img class="mini'+sm+'" loading="lazy" src="'+esc(r.image_thumb)+'"/>':dot(r.kind))+'<b>'+esc(r.label)+'</b> <span class="muted">'+(r.disambig?esc(r.disambig)+' · ':'')+esc(r.prov_class||r.gc_class||'')+'</span>'+confDot(r.canon_confidence)+'</li>').join('')+'</ul>';
}
// ── Admin: choose how portraits render (source / app-style / both) ──
function admin(){
  const m=imgMode();
  const opt=(v,t,d)=>'<label class="'+(m===v?'on':'')+'" data-m="'+v+'"><input type="radio" name="im" '+(m===v?'checked':'')+'/><span><b>'+t+'</b><br><span class="muted">'+d+'</span></span></label>';
  V.innerHTML='<div class="card admin"><h3 class="muted" style="margin-top:0">Admin · entity image display</h3>'+
   '<p class="hint">Every canonical person / place / event can carry two portraits: the <b>source</b> image (Wikimedia Commons, with attribution) and a <b>consistent app-style render</b>. The app style is currently derived from the source for a uniform look; a generative backfill can replace it per entity (the <span class="mono">image_styled_url</span> column).</p>'+
   opt('both','Show both','Source + app-style render side by side (default).')+
   opt('original','Original only','Unmodified Wikimedia Commons image.')+
   opt('styled','App style only','Consistent stylized render for a uniform look.')+
   '<div class="hint">Saved in this browser. Affects the explorer, inheritance list, and trust graph.</div></div>'+
   '<div class="card"><h3 class="muted" style="margin-top:0">Admin · data integrity</h3>'+
   '<p class="hint">Every node records how confidently its data is bound to a canonical id. Native Theographic ids are rock-solid (1.0); brought-in data (Wikidata + images) is scored by match strength — exact-unique matches near 1.0, name-collision or label-mismatch matches lower. Suspect bindings are listed here for review, never hidden.</p>'+
   '<div id="ibands" class="gchips"></div>'+
   '<div class="hint" style="margin:8px 0">Show bindings at or below: '+
   '<select id="ithr"><option value="1">all brought-in</option><option value="0.9" selected>&lt; 0.90 (needs review)</option><option value="0.7">&lt; 0.70 (suspect)</option></select></div>'+
   '<div id="ilist"></div></div>';
  document.querySelectorAll('.admin label').forEach(l=>l.onclick=()=>{localStorage.setItem(IMG_KEY,l.dataset.m);admin();});
  const thr=document.getElementById('ithr');thr.onchange=()=>loadIntegrity(thr.value);
  loadIntegrity(thr.value);
}
async function loadIntegrity(max){
  const d=await api('/integrity?max='+encodeURIComponent(max));
  document.getElementById('ibands').innerHTML=bandChips(d.bands);
  const sm=imgMode()==='styled'?' styled':'';
  document.getElementById('ilist').innerHTML=d.results.length
    ?'<ul class="list">'+d.results.map(r=>'<li onclick="showNodeTab(\\''+r.id+'\\')">'+(r.image_thumb?'<img class="mini'+sm+'" loading="lazy" src="'+esc(r.image_thumb)+'"/>':dot(r.kind))+'<b>'+esc(r.label)+'</b> <span class="muted">'+esc(r.canon_id||'')+(r.disambig?' · '+esc(r.disambig):'')+'<br>'+esc(r.canon_basis||'')+'</span>'+confBadge(r.canon_confidence,r.canon_method)+'</li>').join('')+'</ul>'
    :'<div class="hint">No bindings at or below this threshold.</div>';
}
async function overview(){
  V.innerHTML='<div class="card">loading…</div>';
  const d=await api('/overview');
  const t=d.totals;
  const provColors={'prov:Agent':'#2563eb','prov:Activity':'#0e7490','prov:Entity':'#b45309'};
  const provTot=d.prov.reduce((a,r)=>a+r.n,0);
  V.innerHTML=
   '<div class="card"><h3 class="muted" style="margin-top:0">Graph</h3><div class="grid">'+
   Object.entries(t).map(([k,v])=>'<div class="stat"><div class="n">'+v.toLocaleString()+'</div><div class="l">'+k+'</div></div>').join('')+'</div></div>'+
   '<div class="card"><h3 class="muted">PROV-O classification of Bible objects</h3><div class="bar">'+
   d.prov.map(r=>'<div style="flex:'+r.n+';background:'+(provColors[r.prov_class]||'#888')+'">'+r.prov_class.replace('prov:','')+' '+r.n+'</div>').join('')+'</div>'+
   '<div class="hint">'+d.kinds.map(k=>dot(k.kind)+' '+k.kind+' '+k.n).join(' &nbsp; ')+'</div>'+
   '<div class="hint">trust signals: '+(d.signals||[]).map(s=>'<span class="chip" style="'+(s.polarity==='positive'?'background:#e7f6ee;color:#1a8a4f':s.polarity==='negative'?'background:#fdeceA;color:#c0392b':'background:#fbf0e6;color:#b45309')+'">'+s.polarity+' '+s.n+'</span>').join(' ')+' &nbsp;·&nbsp; temporal: 525 dated nodes (OWL-Time)</div></div>'+
   (d.inheritance?'<div class="card"><h3 class="muted" style="margin-top:0">Inheritance · canonical portraits · trust signals</h3>'+
    '<div class="hint" style="margin-bottom:10px">A query for <span class="mono">prov:Agent</span> resolves <b style="color:var(--ink)">'+d.inheritance.viaClosure.toLocaleString()+'</b> instances across its <b>'+d.inheritance.subclasses+'</b> subclasses (people <i>and</i> organizations) via the stored subclass closure — a naive exact-class match returns just <b>'+d.inheritance.naiveExact+'</b>. <a class="link" onclick="document.querySelector(\\'[data-t=classes]\\').click()">explore inheritance →</a></div>'+
    '<div class="grid">'+(d.scores||[]).map(s=>'<div class="stat"><div class="n">'+s.avg+'</div><div class="l">'+(SDIM[s.dimension]||s.dimension)+' · avg<br><span class="muted">'+s.n.toLocaleString()+' scored</span></div></div>').join('')+'</div>'+
    '<div class="hint"><b>'+(d.withImage||0)+'</b> canonical entities carry a portrait (Wikimedia source + consistent app-style render). <a class="link" onclick="document.querySelector(\\'[data-t=admin]\\').click()">image settings →</a></div>'+
    (d.integrity?'<div class="hint" style="margin-top:10px">canonical-id confidence: '+bandChips(d.integrity)+' &nbsp;<a class="link" onclick="document.querySelector(\\'[data-t=admin]\\').click()">review matches →</a><br><span class="muted">native source ids are rock-solid (1.0); brought-in data (Wikidata/images) is scored by match strength so suspect bindings stay visible.</span></div>':'')+'</div>':'')+
   (d.sourceCoverage&&d.sourceCoverage.length?'<div class="card"><h3 class="muted" style="margin-top:0">Multi-source A-box · provenance &amp; corroboration</h3>'+
    '<div class="hint" style="margin-bottom:8px"><b>'+(d.coverage?.xrefs||0).toLocaleString()+'</b> cross-references · <b>'+(d.coverage?.forms||0).toLocaleString()+'</b> original-language forms · <b>'+(d.coverage?.attestations||0).toLocaleString()+'</b> source assertions (DOLCE+DnS <span class="mono">dns:Assertion</span>). Each external dataset is reconciled to a canonical id with a recorded match confidence + SKOS relation; independent agreeing assertions feed the <b>source corroboration</b> trust signal (<span class="mono">gc:SourceAssessment</span>).</div>'+
    '<table><tr><th>source</th><th>license</th><th>attestations</th></tr>'+d.sourceCoverage.map(s=>'<tr><td><b>'+esc(s.abbrev)+'</b></td><td class="muted">'+esc(s.license)+'</td><td>'+s.n.toLocaleString()+'</td></tr>').join('')+'</table>'+
    (d.origins?'<div class="hint">canonical nodes by origin: '+d.origins.map(o=>'<span class="chip" style="background:#eef2fb;color:#3a4a63">'+esc(o.origin_source)+' '+o.n.toLocaleString()+'</span>').join(' ')+' &nbsp;<span class="muted">— unmatched entities from a source mint new canonical nodes (origin-tagged, lower confidence).</span></div>':'')+'</div>':'')+
   '<div class="card"><h3 class="muted">Global Church Ontology → PROV-O alignment (validation)</h3>'+
   '<table><tr><th>alignment</th><th>GCO classes</th></tr>'+
   d.gcoAlign.map(g=>'<tr><td>'+tagAlign(g.prov_align)+'</td><td>'+g.n+'</td></tr>').join('')+'</table>'+
   '<div class="hint">Open <a class="link" onclick="document.querySelector(\\'[data-t=validate]\\').click()">Validate GCO</a> to inspect each term + the unaligned ones.</div></div>';
}
function tagAlign(a){
  if(a&&a.startsWith('prov:'))return '<span class="chip tag-prov">'+a+'</span>';
  if(a&&a.startsWith('dns:'))return '<span class="chip tag-dns">'+a+'</span>';
  if(a==='unaligned')return '<span class="chip tag-un">unaligned</span>';
  return '<span class="chip">'+esc(a)+'</span>';
}
async function explore(){
  V.innerHTML='<div class="card"><input id="q" placeholder="Search people, places, events, orgs… (e.g. David, Jerusalem, Exodus)"/><div id="res"></div></div><div id="detail"></div>';
  const q=document.getElementById('q');q.focus();
  let timer;q.oninput=()=>{clearTimeout(timer);timer=setTimeout(async()=>{
    if(q.value.trim().length<2){document.getElementById('res').innerHTML='';return;}
    const d=await api('/search?q='+encodeURIComponent(q.value.trim()));
    document.getElementById('res').innerHTML='<ul class="list">'+d.results.map(r=>'<li onclick="showNode(\\''+r.id+'\\')">'+dot(r.kind)+'<b>'+esc(r.label)+'</b> <span class="muted">'+(r.disambig?esc(r.disambig)+' · ':'')+(r.prov_class||'')+(r.gc_class?' · '+r.gc_class:'')+'</span>'+confDot(r.canon_confidence)+'</li>').join('')+'</ul>';
  },180);};
}
async function showNode(id){
  const d=await api('/node/'+encodeURIComponent(id));if(!d.ok)return;
  const n=d.node;const cls=[['prov',n.prov_class],['dul',n.dul_class],['org',n.org_class],['geo',n.geo_class],['aps',n.aps_class],['gc',n.gc_class]].filter(x=>x[1]);
  const grp=(arr,dir)=>{const by={};arr.forEach(e=>{(by[e.rel]=by[e.rel]||[]).push(e)});return Object.entries(by).map(([rel,es])=>'<div class="edge-grp"><div class="rel">'+esc(rel)+(dir==='in'?' (inverse)':'')+'</div>'+es.map(e=>'<a onclick="showNode(\\''+e.id+'\\')">'+dot(e.kind)+esc(e.label)+'</a>').join('')+'</div>').join('');};
  const geo=n.lat!=null?'<div class="hint">📍 '+n.lat+', '+n.long+' &nbsp;<span class="mono">'+esc(n.wkt||'')+'</span></div>':'';
  const ord=(y)=>y==null?'':(Math.abs(y)+(y<0?' BC':' AD'));
  const temporal=n.t_start!=null?'<div class="hint">🕑 '+ord(n.t_start)+(n.t_end!=null&&n.t_end!==n.t_start?' – '+ord(n.t_end):'')+'</div>':'';
  const sigCss=(p)=>p==='positive'?'background:#e7f6ee;color:#1a8a4f':p==='negative'?'background:#fdeceA;color:#c0392b':'background:#fbf0e6;color:#b45309';
  const sigs=(d.signals&&d.signals.length)?'<div style="margin-top:8px">'+d.signals.map(s=>'<span class="chip" style="'+sigCss(s.polarity)+'">'+(s.polarity==='positive'?'＋':s.polarity==='negative'?'－':'~')+' '+esc(s.basis)+(s.osis?' · '+esc(s.osis):'')+'</span>').join('')+'</div>':'';
  const det=document.getElementById('detail')||V;
  det.innerHTML='<div class="card"><h2>'+dot(n.kind)+esc(n.label)+'</h2>'+idrow(n)+portrait(n)+
   '<div>'+cls.map(c=>'<span class="chip" style="background:#eef2fb;color:#3a4a63">'+c[0]+': '+esc(c[1])+'</span>').join('')+'</div>'+temporal+geo+sigs+scoreBars(d.scores)+formsHtml(d.forms)+xrefsHtml(d.xrefs)+
   (d.out.length?'<h3 class="muted" style="margin-top:16px">relationships</h3>'+grp(d.out,'out'):'')+
   (d.in.length?grp(d.in,'in'):'')+
   '<h3 class="muted" style="margin-top:16px">attested in '+d.verses.length+' verses</h3><div class="verses">'+d.verses.map(v=>'<span>'+esc(v)+'</span>').join('')+'</div>'+
   provHtml(d.sources,n.origin_source)+
   '<div class="hint"><a class="link" onclick="graphFor(\\''+n.id+'\\')">→ view in trust graph</a></div></div>';
  det.scrollIntoView({behavior:'smooth',block:'nearest'});
}
let graphCenter=null,gFilters={},gExpand={};
function graphFor(id){graphCenter=id;gExpand={};gFilters={};tab='graph';document.querySelectorAll('nav button').forEach(x=>x.classList.toggle('on',x.dataset.t==='graph'));graph();}
function famOf(rel){const m={'gc:hasParent':'family','gc:hasChild':'family','gc:hasSibling':'family','gc:hasPartner':'family','org:memberOf':'org','org:hasMember':'org','org:member':'org','org:organization':'org','org:role':'org','prov:wasAssociatedWith':'events','gc:holdsRole':'role','aps:hasSkill':'role','gc:bornAt':'place','gc:diedAt':'place'};return m[rel]||'role';}
const SECT={family:{label:'Family',color:'#e87c3e',a:[0,60],th:10},role:{label:'Role/Skill',color:'#0d9488',a:[60,120],th:8},events:{label:'Events',color:'#0e7490',a:[120,210],th:4},place:{label:'Places',color:'#b45309',a:[210,270],th:99},org:{label:'Organization',color:'#9333ea',a:[270,360],th:6}};
const FORD=['family','role','events','place','org'];
const sigCol={positive:'#1a8a4f',negative:'#c0392b',mixed:'#b45309'};
const ordYr=(y)=>y==null?'':(Math.abs(y)+(y<0?' BC':' AD'));
function P(cx,cy,deg,r){const a=deg*Math.PI/180;return{x:cx+r*Math.sin(a),y:cy-r*Math.cos(a)};}
function shp(kind,x,y,r){const f=KC[kind]||'#888';
 if(kind==='organization')return '<rect x="'+(x-r)+'" y="'+(y-r)+'" width="'+(2*r)+'" height="'+(2*r)+'" rx="5" fill="'+f+'"/>';
 if(kind==='event')return '<polygon points="'+x+','+(y-r)+' '+(x+r)+','+y+' '+x+','+(y+r)+' '+(x-r)+','+y+'" fill="'+f+'"/>';
 if(kind==='place')return '<polygon points="'+(x-r)+','+(y-r*0.7)+' '+(x+r)+','+(y-r*0.7)+' '+x+','+(y+r)+'" fill="'+f+'"/>';
 if(kind==='role'||kind==='skill'){let p='';for(let i=0;i<6;i++){const a=Math.PI/180*(60*i-30);p+=(x+r*Math.cos(a))+','+(y+r*Math.sin(a))+' ';}return '<polygon points="'+p+'" fill="'+f+'"/>';}
 if(kind==='membership'||kind==='responsibility')return '<circle cx="'+x+'" cy="'+y+'" r="'+(r*0.8)+'" fill="#fff" stroke="'+f+'" stroke-dasharray="2 2"/>';
 return '<circle cx="'+x+'" cy="'+y+'" r="'+r+'" fill="'+f+'"/>';}
function badge(x,y,r,sig){if(!sig)return '';const bx=x+r*0.72,by=y-r*0.72;if(sig==='mixed')return '<circle cx="'+bx+'" cy="'+by+'" r="5" fill="#1a8a4f" stroke="#fff"/><path d="M'+bx+' '+(by-5)+' A5 5 0 0 1 '+bx+' '+(by+5)+' Z" fill="#c0392b"/>';return '<circle cx="'+bx+'" cy="'+by+'" r="5" fill="'+sigCol[sig]+'" stroke="#fff" stroke-width="1"/>';}
async function graph(){
  V.innerHTML='<div class="card"><input id="gq" placeholder="Center on a person/org/event… (e.g. Jesus, Paul, Nation of Israel)"/><div id="gres"></div><div id="gwrap"></div></div><div id="gtip" class="gtip"></div>';
  const gq=document.getElementById('gq');
  let timer;gq.oninput=()=>{clearTimeout(timer);timer=setTimeout(async()=>{
    const r=document.getElementById('gres');
    if(gq.value.trim().length<2){r.innerHTML='';return;}
    const d=await api('/search?q='+encodeURIComponent(gq.value.trim()));
    r.innerHTML='<ul class="list">'+d.results.slice(0,8).map(x=>'<li data-pick="'+x.id+'">'+dot(x.kind)+esc(x.label)+' <span class="muted">'+(x.prov_class||'')+'</span></li>').join('')+'</ul>';
    r.querySelectorAll('[data-pick]').forEach(li=>li.onclick=()=>{graphCenter=li.dataset.pick;gExpand={};gFilters={};r.innerHTML='';gq.value='';drawGraph();});
  },180);};
  if(!graphCenter){const d=await api('/search?q=Jesus');graphCenter=(((d.results||[]).find(x=>x.label==='Jesus'))||(d.results||[])[0]||{}).id;}
  drawGraph();
}
async function drawGraph(){
  const wrap=document.getElementById('gwrap');wrap.innerHTML='<div class="ghint">loading…</div>';
  const d=await api('/graph?center='+encodeURIComponent(graphCenter));if(!d.ok){wrap.innerHTML='<div class="ghint">could not load this node</div>';return;}
  const W=1040,H=560,cx=500,cy=280,center=d.center,byId={};d.nodes.forEach(n=>byId[n.id]=n);
  const famByNode={},relByNode={};
  d.edges.forEach(e=>{const nb=e.from===center?e.to:e.from;if(nb===center)return;famByNode[nb]=famByNode[nb]||famOf(e.rel);relByNode[nb]=relByNode[nb]||e.rel;});
  let neighbors=d.nodes.filter(n=>n.id!==center).filter(n=>!gFilters[famByNode[n.id]]);
  const pos={};pos[center]={x:cx,y:cy};const clusters=[];const drawn=new Set([center]);
  if(neighbors.length<=3){
    neighbors.forEach((n,i)=>{pos[n.id]=P(cx,cy,(i*120)%360,180);drawn.add(n.id);});
  }else{
    FORD.forEach(fam=>{const sec=SECT[fam];const mem=neighbors.filter(n=>famByNode[n.id]===fam);if(!mem.length)return;
      if(mem.length>sec.th && !gExpand[fam]){const p=P(cx,cy,(sec.a[0]+sec.a[1])/2,175);clusters.push({fam,x:p.x,y:p.y,n:mem.length,color:sec.color});}
      else{const span=sec.a[1]-sec.a[0],r=mem.length>8?248:175;mem.forEach((n,i)=>{pos[n.id]=P(cx,cy,sec.a[0]+(i+1)*span/(mem.length+1),r);drawn.add(n.id);});}
    });
  }
  let s='<svg id="gsvg" viewBox="0 0 '+W+' '+H+'"><circle cx="'+cx+'" cy="'+cy+'" r="37" fill="none" stroke="#2f6df0" stroke-opacity="0.16" stroke-width="2"/>';
  d.edges.forEach(e=>{const nb=e.from===center?e.to:e.from;if(nb===center||!drawn.has(nb))return;const fam=famByNode[nb];const a=pos[center],b=pos[nb];
    s+='<line class="gedge" data-a="'+center+'" data-b="'+nb+'" x1="'+a.x+'" y1="'+a.y+'" x2="'+b.x+'" y2="'+b.y+'" stroke="'+SECT[fam].color+'" stroke-width="1.4" stroke-opacity="0.5"/>';});
  clusters.forEach(c=>{s+='<line class="gedge" x1="'+cx+'" y1="'+cy+'" x2="'+c.x+'" y2="'+c.y+'" stroke="'+c.color+'" stroke-width="3" stroke-dasharray="4 3" stroke-opacity="0.55"/>';
    s+='<g class="gcluster" data-fam="'+c.fam+'"><rect x="'+(c.x-44)+'" y="'+(c.y-16)+'" width="88" height="32" rx="15" fill="#fff" stroke="'+c.color+'" stroke-width="1.6"/><text x="'+c.x+'" y="'+(c.y+4)+'" text-anchor="middle" font-size="12" font-weight="600" fill="'+c.color+'">'+c.n+' '+SECT[c.fam].label.toLowerCase().split('/')[0]+' ＋</text></g>';});
  neighbors.forEach(n=>{const p=pos[n.id];if(!p)return;
    s+='<g class="gnode" data-id="'+n.id+'">'+shp(n.kind,p.x,p.y,11)+badge(p.x,p.y,11,n.sig)+'<text class="gnlabel" x="'+p.x+'" y="'+(p.y+24)+'" text-anchor="middle" font-size="10" fill="#33404f">'+esc(n.label.length>16?n.label.slice(0,15)+'…':n.label)+'</text></g>';});
  const cn=byId[center]||{label:'?',kind:'person'};
  const gfil=imgMode()==='original'?'none':'sepia(0.6) saturate(1.25) contrast(1.06)';
  const ccirc=cn.img
    ?'<defs><clipPath id="cclip"><circle cx="'+cx+'" cy="'+cy+'" r="28"/></clipPath></defs><image href="'+esc(cn.img)+'" x="'+(cx-28)+'" y="'+(cy-28)+'" width="56" height="56" clip-path="url(#cclip)" preserveAspectRatio="xMidYMid slice" style="filter:'+gfil+'"/><circle cx="'+cx+'" cy="'+cy+'" r="28" fill="none" stroke="#2f6df0" stroke-width="3"/>'
    :'<circle cx="'+cx+'" cy="'+cy+'" r="28" fill="#2f6df0"/>';
  const clab='<text x="'+cx+'" y="'+(cn.img?cy+45:cy+4)+'" text-anchor="middle" font-size="'+(cn.img?11:(cn.label.length>8?9:12))+'" font-weight="700" fill="'+(cn.img?'#1f2733':'#fff')+'">'+esc(cn.label.length>16?cn.label.slice(0,15)+'…':cn.label)+'</text>';
  s+='<g class="gnode gcenter" data-id="'+center+'">'+ccirc+badge(cx,cy,28,cn.sig)+clab+'</g></svg>';
  const tline=cn.tStart!=null?' · '+ordYr(cn.tStart)+(cn.tEnd!=null&&cn.tEnd!==cn.tStart?'–'+ordYr(cn.tEnd):''):'';
  let chips='';FORD.forEach(f=>{const on=!gFilters[f];chips+='<span class="gchip'+(on?' on':'')+'" data-fam="'+f+'"'+(on?' style="background:'+SECT[f].color+';color:#fff;border-color:'+SECT[f].color+'"':'')+'>'+SECT[f].label+'</span>';});
  const legend='<div class="glegend">'+[['person','person'],['organization','org'],['event','event'],['place','place'],['role','role']].map(k=>dot(k[0])+k[1]).join(' ')+' &nbsp;·&nbsp; ◇ event ▽ place ⬡ role ☐ org &nbsp;·&nbsp; <span style="color:#1a8a4f">＋</span>/<span style="color:#c0392b">－</span> trust signal</div>';
  wrap.innerHTML='<div class="gbread"><b>'+dot(cn.kind)+esc(cn.label)+'</b> <span class="muted">'+cn.kind+tline+' · '+d.edges.length+' relationships</span> · <a class="link" data-details="1">details ↗</a></div><div class="gchips">'+chips+'</div>'+s+legend+'<div class="ghint">Hover a node to isolate its relationship · click a node to recenter · click a cluster pill to expand · toggle a family above to filter.</div>';
  const svg=document.getElementById('gsvg'),tip=document.getElementById('gtip');
  wrap.querySelectorAll('.gnode').forEach(g=>{const id=g.dataset.id;
    g.addEventListener('mouseenter',()=>{svg.classList.add('dim');g.classList.add('hot');
      svg.querySelectorAll('.gedge').forEach(e=>{if(e.dataset.a===id||e.dataset.b===id){e.classList.add('hot');const o=e.dataset.a===id?e.dataset.b:e.dataset.a;const og=svg.querySelector('.gnode[data-id=\\''+o+'\\']');if(og)og.classList.add('hot');}});
      const n=byId[id];if(n){tip.style.display='block';tip.innerHTML=(n.img?'<img src="'+esc(n.img)+'" style="width:100%;height:88px;object-fit:cover;border-radius:6px;margin-bottom:5px;filter:'+(imgMode()==='original'?'none':'sepia(.6) saturate(1.25) contrast(1.06)')+'"/>':'')+'<b>'+esc(n.label)+'</b> <span class="muted">'+n.kind+'</span>'+(n.tStart!=null?'<div class="muted">'+ordYr(n.tStart)+(n.tEnd!=null&&n.tEnd!==n.tStart?'–'+ordYr(n.tEnd):'')+'</div>':'')+(relByNode[id]?'<div class="muted">'+esc(relByNode[id])+'</div>':'')+(n.sig?'<div style="color:'+sigCol[n.sig]+'">'+(n.sig==='positive'?'＋ ':n.sig==='negative'?'－ ':'± ')+n.sig+' signal</div>':'');}});
    g.addEventListener('mousemove',ev=>{tip.style.left=Math.min(ev.clientX+14,innerWidth-240)+'px';tip.style.top=(ev.clientY+14)+'px';});
    g.addEventListener('mouseleave',()=>{svg.classList.remove('dim');svg.querySelectorAll('.hot').forEach(x=>x.classList.remove('hot'));tip.style.display='none';});
    g.addEventListener('click',()=>{if(id===center){showNodeTab(center);}else{graphCenter=id;gExpand={};drawGraph();}});});
  wrap.querySelectorAll('.gcluster').forEach(g=>g.addEventListener('click',()=>{gExpand[g.dataset.fam]=!gExpand[g.dataset.fam];drawGraph();}));
  wrap.querySelectorAll('.gchip').forEach(ch=>ch.addEventListener('click',()=>{gFilters[ch.dataset.fam]=!gFilters[ch.dataset.fam];drawGraph();}));
  const det=wrap.querySelector('[data-details]');if(det)det.addEventListener('click',()=>showNodeTab(center));
}
function showNodeTab(id){tab='explore';document.querySelectorAll('nav button').forEach(x=>x.classList.toggle('on',x.dataset.t==='explore'));explore().then(()=>showNode(id));}
async function validate(){
  V.innerHTML='<div class="card">loading…</div>';
  const d=await api('/validate');
  const order=['prov:Agent','prov:Activity','prov:Entity','dns:Situation','dns:Description','dns:Concept','unaligned'];
  const tally=Object.fromEntries(d.tally.map(t=>[t.prov_align,t.n]));
  const total=d.tally.reduce((a,t)=>a+t.n,0);
  const usage=Object.fromEntries(d.usage.map(u=>[u.prov_class,u.n]));
  V.innerHTML='<div class="card"><h3 class="muted" style="margin-top:0">GCO classes by PROV-O alignment ('+total+' classes)</h3>'+
   '<table><tr><th>alignment</th><th>GCO classes</th><th>Bible instances exercising it</th></tr>'+
   order.filter(a=>tally[a]).map(a=>'<tr><td>'+tagAlign(a)+'</td><td><a class="link" onclick="valFilter(\\''+a+'\\')">'+tally[a]+' terms</a></td><td>'+(a.startsWith('prov:')?(usage[a]||0).toLocaleString()+' '+a.replace('prov:','').toLowerCase()+'s':'—')+'</td></tr>').join('')+'</table>'+
   '<div class="hint"><b>'+(((tally['prov:Agent']||0)+(tally['prov:Activity']||0)+(tally['prov:Entity']||0)))+'</b> of '+total+' GCO classes align to a PROV-O class; <b style="color:var(--no)">'+(tally['unaligned']||0)+'</b> are unaligned (review candidates), '+order.filter(a=>a.startsWith('dns:')).reduce((s,a)=>s+(tally[a]||0),0)+' are DnS constructs.</div></div>'+
   '<div id="vterms"></div>';
  valFilter('unaligned');
}
async function valFilter(a){
  const d=await api('/validate?align='+encodeURIComponent(a));
  document.getElementById('vterms').innerHTML='<div class="card"><h3 class="muted" style="margin-top:0">'+tagAlign(a)+' — '+d.terms.length+' GCO classes</h3>'+
   '<table><tr><th>GCO class</th><th>label</th><th>subClassOf</th><th>comment</th></tr>'+
   d.terms.map(t=>'<tr><td class="mono">'+esc(t.curie)+'</td><td>'+esc(t.label)+'</td><td class="mono muted">'+esc(t.parent||'')+'</td><td class="muted">'+esc((t.comment||'').slice(0,120))+'</td></tr>').join('')+'</table></div>';
  document.getElementById('vterms').scrollIntoView({behavior:'smooth',block:'nearest'});
}
render();
</script></body></html>`;
