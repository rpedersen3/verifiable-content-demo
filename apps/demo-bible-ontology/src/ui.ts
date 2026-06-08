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
svg{width:100%;height:520px;background:#fbfcfe;border:1px solid var(--line);border-radius:10px}
.gnode{cursor:pointer}.gnode text{font-size:11px;font-weight:600;fill:#1f2733}
.gedge{stroke:#c4cdda;stroke-width:1.3}.gedge-l{font-size:8.5px;fill:#94a0b3}
.hint{font-size:12px;color:var(--muted);margin:10px 0 0}
a.link{color:var(--accent);cursor:pointer;text-decoration:none}
</style></head><body><div class="wrap">
<h1>Bible Ontology</h1>
<div class="sub">A PROV-O graph of the Bible (Agent · Activity · Entity) over DUL · W3C ORG · GeoSPARQL · aps:skills · gc:, used to validate the Global Church Ontology. Data: Theographic Bible Metadata (CC-BY-SA).</div>
<nav>
 <button data-t="overview" class="on">Overview</button>
 <button data-t="explore">Explore</button>
 <button data-t="graph">Trust graph</button>
 <button data-t="validate">Validate GCO</button>
</nav>
<div id="view"></div>
</div>
<script>
const KC={person:'#2563eb',organization:'#9333ea',event:'#0e7490',place:'#b45309',role:'#0d9488',skill:'#7c3aed',membership:'#94a0b3',responsibility:'#475569'};
const V=document.getElementById('view');
const api=(p)=>fetch('/api'+p).then(r=>r.json());
const esc=(s)=>String(s??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const dot=(k)=>'<span class="kdot" style="background:'+(KC[k]||'#888')+'"></span>';
let tab='overview';

document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{tab=b.dataset.t;document.querySelectorAll('nav button').forEach(x=>x.classList.toggle('on',x===b));render();});

async function render(){
  if(tab==='overview')return overview();
  if(tab==='explore')return explore();
  if(tab==='graph')return graph();
  if(tab==='validate')return validate();
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
    document.getElementById('res').innerHTML='<ul class="list">'+d.results.map(r=>'<li onclick="showNode(\\''+r.id+'\\')">'+dot(r.kind)+'<b>'+esc(r.label)+'</b> <span class="muted">'+(r.prov_class||'')+(r.gc_class?' · '+r.gc_class:'')+'</span></li>').join('')+'</ul>';
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
  det.innerHTML='<div class="card"><h2>'+dot(n.kind)+esc(n.label)+'</h2>'+
   '<div>'+cls.map(c=>'<span class="chip" style="background:#eef2fb;color:#3a4a63">'+c[0]+': '+esc(c[1])+'</span>').join('')+'</div>'+temporal+geo+sigs+
   (d.out.length?'<h3 class="muted" style="margin-top:16px">relationships</h3>'+grp(d.out,'out'):'')+
   (d.in.length?grp(d.in,'in'):'')+
   '<h3 class="muted" style="margin-top:16px">attested in '+d.verses.length+' verses</h3><div class="verses">'+d.verses.map(v=>'<span>'+esc(v)+'</span>').join('')+'</div>'+
   '<div class="hint"><a class="link" onclick="graphFor(\\''+n.id+'\\')">→ view in trust graph</a></div></div>';
  det.scrollIntoView({behavior:'smooth',block:'nearest'});
}
let graphCenter=null;
function graphFor(id){graphCenter=id;tab='graph';document.querySelectorAll('nav button').forEach(x=>x.classList.toggle('on',x.dataset.t==='graph'));graph();}
async function graph(){
  V.innerHTML='<div class="card"><input id="gq" placeholder="Center the graph on a person/org/event… (e.g. Paul, Nation of Israel)"/><div id="gres"></div><div id="gsvg"></div><div class="hint">person ↔ organization (membership) ↔ activity (participation) ↔ entity. Click any node to recenter.</div></div>';
  const gq=document.getElementById('gq');
  let timer;gq.oninput=()=>{clearTimeout(timer);timer=setTimeout(async()=>{
    if(gq.value.trim().length<2)return;
    const d=await api('/search?q='+encodeURIComponent(gq.value.trim()));
    document.getElementById('gres').innerHTML='<ul class="list">'+d.results.slice(0,8).map(r=>'<li onclick="graphCenter=\\''+r.id+'\\';drawGraph()">'+dot(r.kind)+esc(r.label)+' <span class="muted">'+(r.prov_class||'')+'</span></li>').join('')+'</ul>';
  },180);};
  if(!graphCenter){const d=await api('/search?q=Paul');graphCenter=(d.results[0]||{}).id;}
  drawGraph();
}
async function drawGraph(){
  document.getElementById('gres').innerHTML='';
  const d=await api('/graph?center='+encodeURIComponent(graphCenter));if(!d.ok)return;
  const W=1040,H=520,cx=W/2,cy=H/2;
  const others=d.nodes.filter(n=>n.id!==d.center);
  const pos={};pos[d.center]={x:cx,y:cy};
  others.forEach((n,i)=>{const a=2*Math.PI*i/others.length;pos[n.id]={x:cx+Math.cos(a)*Math.min(360,140+others.length*4),y:cy+Math.sin(a)*Math.min(220,90+others.length*3)};});
  const lab=Object.fromEntries(d.nodes.map(n=>[n.id,n]));
  let s='<svg viewBox="0 0 '+W+' '+H+'">';
  d.edges.forEach(e=>{const a=pos[e.from],b=pos[e.to];if(!a||!b)return;s+='<line class="gedge" x1='+a.x+' y1='+a.y+' x2='+b.x+' y2='+b.y+'/>';s+='<text class="gedge-l" x='+((a.x+b.x)/2)+' y='+((a.y+b.y)/2-2)+' text-anchor="middle">'+esc(e.rel.split(':').pop())+'</text>';});
  d.nodes.forEach(n=>{const p=pos[n.id];const r=n.id===d.center?9:6;s+='<g class="gnode" onclick="graphCenter=\\''+n.id+'\\';drawGraph()"><circle cx='+p.x+' cy='+p.y+' r='+r+' fill="'+(KC[n.kind]||'#888')+'"/><text x='+(p.x+9)+' y='+(p.y+4)+'>'+esc(n.label.length>22?n.label.slice(0,21)+'…':n.label)+'</text></g>';});
  s+='</svg>';
  document.getElementById('gsvg').innerHTML='<div style="margin:8px 0"><b>'+dot(lab[d.center].kind)+esc(lab[d.center].label)+'</b> <span class="muted">'+d.edges.length+' relationships</span> · <a class="link" onclick="showNodeTab(\\''+d.center+'\\')">details</a></div>'+s;
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
