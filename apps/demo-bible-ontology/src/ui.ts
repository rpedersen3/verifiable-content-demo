// Single-page explorer served by the Worker. Vanilla JS + SVG; talks to /api/*.
export const UI = `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Bible Explorer</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css"/>
<script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
<style>
:root{--bg:#f6f8fb;--card:#fff;--ink:#1f2733;--muted:#6b7785;--line:#e4e9f0;--accent:#2f6df0;--ok:#1a8a4f;--no:#c0392b;--warn:#b45309;--mono:ui-monospace,Menlo,monospace}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,Segoe UI,Roboto,sans-serif}
.wrap{max-width:1080px;margin:0 auto;padding:24px 20px 64px}
.site-header{display:flex;align-items:baseline;gap:14px;margin-bottom:14px}
.brand-name{font-size:22px;font-weight:800;color:var(--ink);cursor:pointer;letter-spacing:-.01em}
.brand-name:hover{color:var(--accent)}
.brand-sub{font-size:12px;color:var(--muted)}
.book-sel{margin-left:auto;align-self:center;font:13px system-ui;padding:5px 9px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--ink);cursor:pointer;max-width:180px}
#bookSel{margin-left:6px}
.licbar{position:fixed;left:0;right:0;bottom:0;background:#3a2a12;color:#ffe8c2;padding:11px 18px;display:none;align-items:center;justify-content:space-between;gap:12px;font-size:14px;z-index:200;box-shadow:0 -2px 12px rgba(0,0,0,.25)}
.licbar button{background:#f0a020;color:#1a1206;border:0;border-radius:7px;padding:6px 13px;font-weight:600;cursor:pointer;margin-left:6px}
.licbar .lic-x{background:transparent;color:#ffe8c2;border:1px solid #6b5a3a}
.licacts{flex-shrink:0;white-space:nowrap}
.licbar.licok{background:#0f3d24;color:#c9f5dd}
.licbar.licok button{background:#1f9d57;color:#04140b}
.licbar.licok .lic-x{background:transparent;color:#c9f5dd;border:1px solid #2f6b48}
.licbar.licpulse{animation:licpulse .5s ease}
@keyframes licpulse{0%{box-shadow:0 -2px 12px rgba(0,0,0,.25)}35%{box-shadow:0 0 0 3px rgba(47,157,87,.55),0 -2px 18px rgba(31,157,87,.5)}100%{box-shadow:0 -2px 12px rgba(0,0,0,.25)}}
.licbar button .tiermeta{display:block;font-weight:500;font-size:10px;opacity:.85;margin-top:1px}
nav{display:flex;gap:4px;flex-wrap:wrap;align-items:center;margin-bottom:22px;padding-bottom:14px;border-bottom:1px solid var(--line)}
nav button{background:transparent;color:var(--muted);border:1px solid var(--line);border-radius:8px;padding:7px 14px;font:inherit;font-size:13px;font-weight:600;cursor:pointer;transition:background .1s,color .1s,border-color .1s}
nav button:hover{background:#eef2fb;color:var(--accent);border-color:#d0dbf5}
nav button.on{background:var(--accent);color:#fff;border-color:var(--accent)}
nav button.nav-util{font-size:12px;padding:5px 11px}
nav button.nav-util:hover{background:#f8fafd;color:var(--ink)}
nav button.nav-util.on{background:#eef2fb;color:var(--accent);border-color:var(--accent)}
.nav-sep{width:1px;height:22px;background:var(--line);margin:0 6px;align-self:center;flex:none}
/* top-right account menu */
.acctmenu{position:relative;display:inline-block}
.acctmenu-trigger{display:inline-flex;align-items:center;gap:7px;background:#fff;border:1px solid var(--line);border-radius:9px;padding:6px 11px;font:inherit;font-size:13px;font-weight:600;color:var(--ink);cursor:pointer}
.acctmenu-trigger:hover{border-color:#d0dbf5;background:#f8fafd}
.acctmenu-dot{color:var(--ok);font-size:10px}.acctmenu-caret{color:var(--muted);font-size:10px}
.acctmenu-lbl{max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.acctmenu-pop{display:none;position:absolute;top:calc(100% + 6px);right:0;z-index:60;min-width:248px;background:#fff;border:1px solid var(--line);border-radius:11px;box-shadow:0 10px 30px rgba(20,30,50,.18);overflow:hidden}
.acctmenu-pop.open{display:block}
.acctmenu-head{padding:12px 14px;border-bottom:1px solid var(--line);background:#f8fafd}
.acctmenu-name{font-weight:700;font-size:14px;color:var(--ink)}
.acctmenu-did{margin-top:3px;color:var(--muted);word-break:break-all;line-height:1.35}
.acctmenu-item{display:block;width:100%;text-align:left;background:transparent;border:0;padding:10px 14px;font:inherit;font-size:13px;font-weight:600;color:var(--ink);cursor:pointer}
.acctmenu-item:hover{background:#eef2fb;color:var(--accent)}
.acctmenu-item.danger{color:var(--no);border-top:1px solid var(--line)}.acctmenu-item.danger:hover{background:#fdecea;color:var(--no)}
/* account area: left section menu + content */
.acct-layout{display:flex;gap:18px;align-items:flex-start}
.acct-side{flex:none;width:188px;display:flex;flex-direction:column;gap:3px;position:sticky;top:14px}
.acct-side .acct-navb{text-align:left;background:transparent;border:1px solid transparent;border-radius:9px;padding:9px 13px;font:inherit;font-size:13.5px;font-weight:600;color:var(--muted);cursor:pointer;transition:background .1s,color .1s}
.acct-side .acct-navb:hover{background:#eef2fb;color:var(--accent)}
.acct-side .acct-navb.on{background:var(--accent);color:#fff}
.acct-main{flex:1;min-width:0}
@media(max-width:720px){.acct-layout{flex-direction:column}.acct-side{width:100%;flex-direction:row;flex-wrap:wrap;position:static}}
.sec-head{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:0 0 12px}
.btn{display:inline-flex;align-items:center;gap:6px;padding:8px 15px;border-radius:8px;border:0;font:inherit;font-size:13px;font-weight:600;cursor:pointer}
.btn-primary{background:var(--accent);color:#fff}.btn-primary:hover{background:#1a58d4}
/* home gateway */
.gw-hero{background:linear-gradient(135deg,#eef3fc,#f6f8fb);border:1px solid var(--line);border-radius:16px;padding:26px 26px 22px;margin-bottom:18px}
.gw-hero h2{margin:0 0 3px;font-size:24px;font-weight:800;letter-spacing:-.01em}
.gw-hero .lead{color:var(--muted);font-size:14px;margin:0 0 16px}
.gw-search-in{font-size:16px;padding:12px 16px;border-radius:10px;border:1px solid var(--line);width:100%;max-width:560px;background:#fff}
.gw-search-in:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px rgba(47,109,240,.12)}
.gw-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px;margin-bottom:18px}
.gw-tile{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:15px 16px;cursor:pointer;transition:box-shadow .15s,transform .15s,border-color .15s}
.gw-tile:hover{box-shadow:0 6px 22px rgba(20,30,50,.10);transform:translateY(-2px);border-color:#c8d5f0}
.gw-preview{height:92px;margin-bottom:12px;border-radius:9px;background:#f8fafd;overflow:hidden;display:flex;align-items:center;justify-content:center}
.gw-preview svg{width:100%;height:100%;display:block}
.gw-label{font-size:15px;font-weight:700;color:var(--ink)}
.gw-desc{font-size:12px;color:var(--muted);line-height:1.4;margin-top:2px}
.gw-feat{display:flex;gap:12px;overflow-x:auto;padding-bottom:6px}
.gw-fc{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:11px;cursor:pointer;text-align:center;flex:none;width:108px;transition:border-color .12s,box-shadow .12s}
.gw-fc:hover{border-color:var(--accent);box-shadow:0 4px 14px rgba(20,30,50,.08)}
.gw-fc img{width:70px;height:70px;object-fit:cover;border-radius:9px;margin:0 auto 7px;display:block}
.gw-fc .fn{font-size:13px;font-weight:700}.gw-fc .fk{font-size:11px;color:var(--muted)}
/* custom map basemap control */
#map{position:relative}
.map-basectl{position:absolute;top:10px;right:10px;z-index:1000;display:flex;gap:2px;background:rgba(255,255,255,.92);border:1px solid var(--line);border-radius:8px;padding:3px;box-shadow:0 2px 8px rgba(20,30,50,.12)}
.map-basbtn{background:transparent;border:0;border-radius:6px;padding:5px 11px;font:12px/1 system-ui,sans-serif;font-weight:600;color:var(--muted);cursor:pointer}
.map-basbtn:hover{background:#eef2fb;color:var(--accent)}.map-basbtn.on{background:var(--accent);color:#fff}
.map-search{position:absolute;top:10px;left:52px;z-index:1000;width:240px}
.map-search input{width:100%;padding:7px 11px;border:1px solid var(--line);border-radius:8px;background:rgba(255,255,255,.96);box-shadow:0 2px 8px rgba(20,30,50,.12);font:13px system-ui;outline:none}
.map-search input:focus{border-color:var(--accent)}
.map-search #mapres{background:#fff;border:1px solid var(--line);border-radius:8px;margin-top:4px;box-shadow:0 4px 14px rgba(20,30,50,.14);max-height:240px;overflow:auto}
.map-search ul.list{margin:0}.map-search ul.list li{padding:6px 10px;font-size:13px}
.mlhov .maplibregl-popup-content{padding:7px 8px 6px;border-radius:8px;box-shadow:0 5px 16px rgba(20,30,50,.2)}
.mlhov .maplibregl-popup-tip{display:none}
.dcrumb{margin:0 0 12px}.dcrumb a{font-weight:600;font-size:13px;background:#eef2fb;color:var(--accent);border:1px solid #d7e2f7;border-radius:8px;padding:6px 12px;display:inline-block;text-decoration:none;cursor:pointer}.dcrumb a:hover{background:#dde7fb}
.reg-tri i{display:block;width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;border-bottom:14px solid #c47d2e;opacity:.8}
.combo{position:relative;max-width:400px}
.combo>input{width:100%;padding-right:30px}
.combo::after{content:"▾";position:absolute;right:11px;top:9px;color:var(--muted);pointer-events:none;font-size:12px}
.combo-menu{display:none;position:absolute;top:100%;left:0;right:0;z-index:30;background:#fff;border:1px solid var(--line);border-radius:8px;margin-top:4px;box-shadow:0 8px 24px rgba(20,30,50,.16);max-height:320px;overflow:auto}
.combo-item{padding:8px 11px;cursor:pointer;font-size:14px;display:flex;align-items:center;gap:7px}
.combo-item:hover,.combo-item.kbd{background:#eef2fb}
.combo-empty{padding:9px 11px;color:var(--muted);font-size:13px}
.gchip.mini{font-size:11px;padding:3px 9px}
.tbadge{font-size:11px;font-weight:700;padding:1px 7px;border-radius:999px;white-space:nowrap}
.trow{margin-left:7px;display:inline-flex;gap:6px;align-items:center;vertical-align:middle}
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
.leaflet-container svg,.leaflet-pane svg{width:auto;height:auto;background:none;border:0;border-radius:0}
.leaflet-container img{border-radius:0;max-width:none}
.leaflet-tooltip.maplabel{background:rgba(255,255,255,.82);border:0;box-shadow:none;color:#1f2733;font-size:11px;font-weight:600;padding:0 4px;white-space:nowrap}
.leaflet-tooltip.maplabel:before{display:none;border:0}
/* verse passage popup */
.verses span{cursor:pointer}.verses span:hover{background:#dbe6fb}
.verses span.bk{background:#fff3c4;color:#7a5c00;font-weight:700;box-shadow:inset 0 0 0 1px #e3b829}.verses span.bk:hover{background:#ffe89a}
.vmodal{display:none;position:fixed;inset:0;z-index:3000;background:rgba(20,30,50,.45);align-items:center;justify-content:center;padding:20px}
.imodal{display:none;position:fixed;inset:0;z-index:4000;background:rgba(0,0,0,.86);align-items:center;justify-content:center;padding:18px;cursor:zoom-out}
.imodal img{max-width:96vw;max-height:94vh;border-radius:8px;box-shadow:0 12px 50px rgba(0,0,0,.6)}
.ihover{display:none;position:fixed;z-index:5000;pointer-events:none;border:2px solid #fff;border-radius:8px;box-shadow:0 10px 40px rgba(0,0,0,.45);overflow:hidden;background:#000}
.mappulse{width:54px;height:54px;border-radius:50%;border:3px solid #ff5a36;pointer-events:none;box-sizing:border-box}
.mappulse::after{content:"";position:absolute;inset:-3px;border-radius:50%;border:3px solid #ff5a36;animation:mpulse 1.5s ease-out infinite}
@keyframes mpulse{0%{transform:scale(.55);opacity:1}100%{transform:scale(1.5);opacity:0}}
.ihover img{display:block;max-width:560px;max-height:400px}
.sigq{cursor:pointer;font-size:12px;margin-left:5px;opacity:.45;user-select:none}.sigq:hover{opacity:1}
.scmodal{display:none;position:fixed;inset:0;z-index:4500;background:rgba(20,30,50,.5);align-items:flex-start;justify-content:center;padding:38px 16px;overflow:auto}
.cgmodal{display:none;position:fixed;inset:0;z-index:4800;background:rgba(20,30,50,.55);align-items:center;justify-content:center;padding:20px}
.cg-card{background:#fff;border-radius:14px;max-width:400px;width:100%;padding:28px 26px;box-shadow:0 24px 70px rgba(0,0,0,.4);text-align:center}
.cg-globe{font-size:40px;line-height:1}
.cg-go{display:block;width:100%;background:var(--accent);color:#fff;border:0;border-radius:10px;padding:12px;font-size:14px;font-weight:700;cursor:pointer;margin-bottom:8px}
.cg-go:hover{filter:brightness(1.08)}
.cg-back{background:transparent;border:0;color:var(--muted);font-size:13px;cursor:pointer;padding:6px}
.sc-card{background:#fff;border-radius:12px;max-width:560px;width:100%;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.35);display:flex;flex-direction:column;gap:8px}
.sc-claim{background:#f6f8fc;border-left:3px solid var(--accent);border-radius:6px;padding:9px 12px;font-size:14px;margin:4px 0}
.sc-analysis{background:#fbfcfe;border:1px solid var(--line);border-radius:8px;padding:12px 14px;font-size:13px;line-height:1.55;margin-top:8px}
.sc-form{display:flex;flex-direction:column;gap:7px;margin-top:6px}
.sc-form input,.sc-form textarea{border:1px solid var(--line);border-radius:8px;padding:8px 10px;font:13px system-ui;outline:none;resize:vertical}
.sc-form input:focus,.sc-form textarea:focus{border-color:var(--accent)}
.sc-fbitem{border-bottom:1px solid var(--line);padding:7px 0;font-size:13px}
.sc-st{font-size:10px;font-weight:700;text-transform:uppercase;border-radius:4px;padding:1px 5px;color:#fff}
.sc-challenge{background:#c0392b}.sc-agree{background:#1a8a4f}.sc-note{background:#7c8696}
.vmodal.on{display:flex}
.vmodal .box{background:#fff;border-radius:12px;max-width:640px;width:100%;max-height:82vh;overflow:auto;padding:18px 22px;box-shadow:0 14px 44px rgba(20,30,50,.32)}
.vmodal h3{margin:0 0 2px;font-size:18px}
.vmodal .x{float:right;cursor:pointer;color:var(--muted);font-size:22px;line-height:.8}
.vmodal .vrow{padding:3px 0;line-height:1.6}
.vmodal .vn{font:11px var(--mono);color:var(--muted);margin-right:7px;vertical-align:top}
.vmodal .vrow.hot{background:#fff7e6;border-radius:5px;padding:4px 7px;margin:1px -7px}
/* inheritance class tree */
.grid2{display:grid;grid-template-columns:300px 1fr;gap:18px}
@media(max-width:720px){.grid2{grid-template-columns:1fr}}
.ctree{font-size:13px;max-height:580px;overflow:auto;border-right:1px solid var(--line);padding-right:8px}
.ctrow a{cursor:pointer}.ctrow a.sel{font-weight:700;color:var(--ink)}
.ccaret{cursor:pointer;user-select:none;display:inline-block;width:14px;color:var(--muted)}
svg#gsvg{height:560px;display:block}
.gnode{cursor:pointer;transition:opacity .12s}.gnode .gnlabel{pointer-events:none;font-weight:500}
.gcluster{cursor:pointer;transition:opacity .12s}
.gedge{transition:opacity .12s}
svg.dim .gedge{opacity:.07}svg.dim .gnode{opacity:.22}svg.dim .gcluster{opacity:.22}
.gedge.hot{opacity:1!important;stroke-width:2.6}.gnode.hot{opacity:1!important}
.gbread{margin:6px 0 2px;font-size:14px}
.gchips{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}
.gchip{font-size:11px;font-weight:600;padding:4px 11px;border-radius:999px;border:1px solid var(--line);color:var(--muted);cursor:pointer;background:#fff;user-select:none}
.gchip.on{background:var(--accent);color:#fff;border-color:var(--accent)}
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
/* portraits: the uploaded source image */
.portrait-wrap{display:flex;gap:14px;flex-wrap:wrap;align-items:flex-start;margin:4px 0 12px}
.portrait{width:128px}.portrait figure{margin:0}
.portrait .tag{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);text-align:center;margin-bottom:4px}
.portrait img{width:128px;height:128px;object-fit:cover;border-radius:10px;display:block;border:1px solid var(--line)}
.portrait .frame{border-radius:12px;padding:5px;background:linear-gradient(145deg,#f4e8c8,#c9a13f);box-shadow:0 2px 9px rgba(120,90,20,.25)}
.portrait .frame img{border-radius:7px;border:2px solid #fff}
.portrait figcaption{font-size:10px;color:var(--muted);margin-top:5px;text-align:center;line-height:1.3}
img.mini{width:24px;height:24px;border-radius:50%;object-fit:cover;flex:none;border:1px solid var(--line)}
/* trust/alignment score bars */
.scores{display:grid;grid-template-columns:122px 1fr 50px;gap:7px 10px;align-items:center;margin:10px 0;font-size:12px}
.scores .sname{color:var(--muted)}
.scores .sname,.scores .sbar,.scores .sval{cursor:help}
.sbar{height:13px;border-radius:7px;background:#eef2f7;position:relative;overflow:hidden}
.sbar i{position:absolute;top:0;bottom:0;display:block;border-radius:7px}
.sbar.bipolar{background:linear-gradient(90deg,#fbe3e3,#fff,#e4f3e8)}
.sbar.bipolar .mid{position:absolute;left:50%;top:-2px;bottom:-2px;width:1px;background:#b8c2cf}
.sval{font:11px var(--mono);text-align:right}
.admin label{display:flex;gap:11px;align-items:flex-start;padding:11px 13px;border:1px solid var(--line);border-radius:9px;margin:7px 0;cursor:pointer}
.admin label.on{border-color:var(--accent);background:#f4f8ff}
.acct{border-collapse:collapse;width:100%;font-size:13px}
.acct td{padding:5px 9px;border-bottom:1px solid var(--line);vertical-align:top}
.acct td:first-child{width:130px;text-transform:capitalize;white-space:nowrap}
.acc-row{display:flex;align-items:center;gap:8px;padding:5px 0;font-size:13px;flex-wrap:wrap}
.acc-st{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;padding:2px 7px;border-radius:10px;color:#fff}
.acc-granted{background:#1a8a4f}.acc-pending{background:#b45309}.acc-denied{background:#c0392b}
.acc-verse{background:#f7f9fc;border:1px solid var(--line);border-radius:9px;padding:11px 13px;font-size:14px;line-height:1.55}
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
/* timeline */
svg#tsvg{display:block;background:#fbfcfe}
.tnode{cursor:pointer}.tnode:hover rect,.tnode:hover polygon{fill-opacity:1;stroke:#1f2733;stroke-width:1.2}
.tnode:hover text{font-weight:600}
</style></head><body><div class="wrap">
<div class="site-header"><span class="brand-name" onclick="nav('home')" title="Home">Bible Explorer</span><span class="brand-sub" id="brandsub"></span><select id="srcSel" class="book-sel" title="Bible source — a licensed source gates every query on your entitlement" onchange="selectSource(this.value)"><option value="bsb">📖 BSB · public</option><option value="lbsb">🔒 LBSB · licensed</option></select><select id="bookSel" class="book-sel" title="Filter the Explore list by book"></select><span id="connectBtn" style="margin-left:10px;display:inline-flex;gap:6px;align-items:center"></span></div>
<nav>
 <button data-t="home" class="on">Home</button>
 <button data-t="explore">Explore</button>
 <button data-t="geo">Map</button>
 <button data-t="timeline">Timeline</button>
 <button data-t="oikos">Oikos</button>
 <button data-t="graph">Graph</button>
 <button data-t="generations">Generations</button>
 <span class="nav-sep"></span>
 <button data-t="classes" class="nav-util">Class Browser</button>
 <button data-t="validate" class="nav-util">Validate GCO</button>
</nav>
<div id="view"></div>
<div id="htip" class="gtip"></div>
<div id="vmodal" class="vmodal"></div>
<div id="imgmodal" class="imodal" onclick="closeImg()"><img id="imgmodalImg" alt=""/></div>
<div id="imghover" class="ihover"><img id="imghoverImg" alt=""/></div>
<div id="sigcourt" class="scmodal" onclick="if(event.target===this)closeSigCourt()"><div class="sc-card" id="sc-body"></div></div>
<div id="connectGate" class="cgmodal" onclick="if(event.target===this)closeConnectGate()"><div class="cg-card" id="cg-body"></div></div>
</div>
<script>
const KC={person:'#2563eb',organization:'#9333ea',event:'#0e7490',place:'#b45309',role:'#0d9488',skill:'#7c3aed',membership:'#94a0b3',responsibility:'#475569',deity:'#7c3aed',concept:'#64748b',interaction:'#db2777',speechact:'#db2777',plan:'#0891b2',step:'#14b8a6'};
const V=document.getElementById('view');
const A2A_BASE='https://demo-bible-a2a-production.richardpedersen3.workers.dev';
// The generic agenticprimitives relayer (per-agent PII vault) — reads the connected user's own
// demo-mcp vault via the delegation their Global.Church home minted at sign-in.
const DEMO_A2A_BASE='https://demo-a2a-production.richardpedersen3.workers.dev';
// All knowledge-graph reads go through the Scripture Agent → MCP vault (not the data Worker directly).
// Active Bible source. Public 'bsb' is open; a licensed source (e.g. 'lbsb') makes EVERY backend query
// carry the reader's edition + id_token so the agent can gate on their entitlement.
let activeEdition=localStorage.getItem('bx.edition')||'bsb';
function apiHeaders(){const h={};if(activeEdition&&activeEdition!=='bsb'){h['x-edition']=activeEdition;if(session&&session.idToken)h['x-id-token']=session.idToken;}return h;}
async function api(p){
  const r=await fetch(A2A_BASE+'/vault'+p,{headers:apiHeaders()});
  // x402: a gated read 402s when there's no grant and no paid pass. ALL custodians do the SAME thing —
  // top up via the home connect ceremony (the license gate's "Buy access"), which charges + mints a pass.
  // No SIWE-only auto-pay, no wallet popup here, no per-custodian branch.
  let j={};try{j=await r.json();}catch(e){}
  if((r.status===401||r.status===402||r.status===403)&&j&&j.gated){licenseGate(j);}
  else if(activeEdition!=='bsb'&&r.ok){accessBar(r.headers.get('X-Lbsb-Access'),r.headers.get('X-Lbsb-Remaining'));}
  return j;
}
// Visual reinforcement on EVERY licensed read: a green bar shows access was accounted for — via a free
// GRANT, your PREPAID pass (+ reads left), or a fresh PAYMENT — and PULSES on each read so you see it react.
let __accSig='';
function accessBar(via,rem){
  if(activeEdition==='bsb'||!via){hideLicenseGate();return;}
  let el=document.getElementById('licbar');
  if(!el){el=document.createElement('div');el.id='licbar';el.className='licbar';document.body.appendChild(el);}
  const ed=activeEdition.toUpperCase();
  const label=via==='grant'?'a free <b>grant</b> (your entitlement)':(via==='prepaid'?'your <b>prepaid pass</b>'+(rem?' · <b>'+esc(rem)+'</b> verse read'+(rem==='1'?'':'s')+' left':''):'a <b>fresh payment</b>');
  el.className='licbar licok';
  el.innerHTML='<span>🔓 <b>'+esc(ed)+'</b> access accounted for — via '+label+'. <span class="muted" style="opacity:.8">Browsing the graph is free; each verse you read draws 1 from your pass.</span></span> <span class="licacts"><button onclick="buyLbsbAccess(\\''+esc(activeEdition)+'\\')">Top up</button> <button class="lic-x" onclick="selectSource(\\'bsb\\')">Public BSB</button></span>';
  el.style.display='flex';
  el.classList.remove('licpulse');void el.offsetWidth;el.classList.add('licpulse'); // pulse on each read
  const sig=via+'|'+(rem||'');if(sig!==__accSig&&via==='prepaid'&&rem){toastPaidMsg('🔓 access · '+esc(rem)+' read'+(rem==='1'?'':'s')+' left on your pass');}
  __accSig=sig;
}
function updateSrcUI(){const s=document.getElementById('srcSel');if(s)s.value=activeEdition;}
function selectSource(ed){activeEdition=ed;localStorage.setItem('bx.edition',ed);updateSrcUI();
  if(ed==='bsb'){hideLicenseGate();}else if(!isConnected()){licenseGate({gated:ed,reason:'sign-in required'});}
  if(typeof applyHash==='function')applyHash();}
function hideLicenseGate(){const el=document.getElementById('licbar');if(el)el.style.display='none';}
// x402 pay-per-use (Phase 4). INERT until the lbsb treasury + PaymentEnforcer + fee asset are
// configured; then this approves a spend budget (x402-pay delegation) and buys a prepaid pass / pays
// per access (reader agent wallet → lbsb treasury), auto-paying on a 402 with no per-call popup.
// Buy a pass (pay-as-you-go OR a subscription tier). ONE path for EVERY custodian (wallet / passkey /
// social): the home charges the chosen amount from your person-treasury → lbsb treasury, signed ONCE by
// your sign-in credential, and grants a pass sized to what you paid. No wallet popup here, no fallback.
async function buyLbsbAccess(ed,tierId){
  if(!requireConnect('buy '+ed+' access'))return;
  const tier=lbsbTier(tierId);
  const what=tier.kind==='subscription'?('the '+tier.label+' subscription — '+tier.reads+' reads for '+tier.usdc+' USDC'):('pay-as-you-go — '+tier.reads+' reads for '+tier.usdc+' USDC');
  if(!confirm('Buy '+what+'?\\n\\nYour home charges '+tier.usdc+' USDC from your person-treasury to the lbsb treasury, authorized once by your sign-in credential (wallet, passkey, or social), and grants a '+tier.reads+'-read pass.'))return;
  connectStartPay(ed,tier.id);
}
function licenseGate(info){
  let el=document.getElementById('licbar');
  if(!el){el=document.createElement('div');el.id='licbar';el.className='licbar';document.body.appendChild(el);}
  const ed=String(info.gated||activeEdition);
  if(info.reason==='sign-in required'||!isConnected()){
    el.innerHTML='<span>🔒 <b>'+esc(ed.toUpperCase())+'</b> is a licensed Bible — connect to request access. Every query is verified against your entitlement.</span> <span class="licacts"><button onclick="promptConnect()">Connect</button> <button class="lic-x" onclick="selectSource(\\'bsb\\')">Use public BSB</button></span>';
  }else{
    // Two-option chooser: pay-as-you-go OR a subscription tier (bigger pass, volume discount) — plus a
    // free owner grant. One credential prompt charges the chosen amount; the pass is sized to what you pay.
    const tierBtns=LBSB_TIERS.map(t=>'<button onclick="buyLbsbAccess(\\''+esc(ed)+'\\',\\''+t.id+'\\')" title="'+t.reads+' reads for '+t.usdc+' USDC">'+(t.kind==='subscription'?'⭐ ':'💳 ')+esc(t.label)+'<span class="tiermeta">'+t.reads+' reads · '+t.usdc+'</span></button>').join('');
    el.innerHTML='<span>🔒 <b>'+esc(ed.toUpperCase())+'</b> '+(info.reason==='payment required'?'is <b>pay-per-use</b>.':'needs access.')+' Pick <b>pay-as-you-go</b> or a <b>subscription</b> — one credential prompt charges your person-treasury → lbsb treasury.</span> <span class="licacts">'+tierBtns+' <button onclick="accRequest(\\''+esc(ed)+'\\')">Request grant</button> <button class="lic-x" onclick="selectSource(\\'bsb\\')">Public BSB</button></span>';
  }
  el.style.display='flex';
}
const esc=(s)=>String(s??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const dot=(k)=>'<span class="kdot" style="background:'+(KC[k]||'#888')+'"></span>';
let tab='overview';

// ── entity portraits: the uploaded source image, unprocessed (app-style render retired) ──
function portrait(n){
  if(!n||!n.image_thumb)return '';
  detImgFull=n.image_url||n.image_thumb;
  const local=String(n.image_url||'').indexOf('/img/')===0;
  const cap=[n.image_license,n.image_attr].filter(Boolean).map(esc).join(' · ');
  const fcap=local?(cap||'Illustrative rendering'):((cap?cap+'<br>':'')+'via Wikimedia Commons');
  return '<div class="portrait-wrap"><div class="portrait"><div class="tag">source</div><figure><img loading="lazy" src="'+esc(n.image_thumb)+'" alt="'+esc(n.label)+'" onclick="openImg(detImgFull)" onmouseenter="imgHover(this.src,event)" onmousemove="imgHoverMove(event)" onmouseleave="imgHoverOut()" style="cursor:zoom-in" title="hover to preview · click for full"/><figcaption>'+fcap+'</figcaption></figure></div></div>';
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
  const akaList=(n.aka||'').split('|').filter(f=>f&&f.toLowerCase()!==String(n.label||'').toLowerCase());
  const akaHtml=akaList.length?'<span class="muted" title="also known as">a.k.a. <b>'+akaList.map(esc).join(', ')+'</b></span>':'';
  if(!n.disambig&&!akaHtml)return '';
  return '<div class="idrow">'+(n.disambig?'<span class="muted">'+esc(n.disambig)+'</span>':'')+akaHtml+'</div>';
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
const SDIM={moral:'Righteousness',wisdom:'Wise ↔ Foolish',faithfulness:'Faithful ↔ Faithless',courage:'Courage',truthfulness:'Truthful ↔ Deceptive',repentance:'Repentant ↔ Hardened',graph_trust:'Graph trust',scriptural_trust:'Scriptural trust',historical_trust:'Historical trust',source_trust:'Source corroboration'};
const SCOL={courage:'#0d9488',graph_trust:'#2563eb',scriptural_trust:'#0e7490',historical_trust:'#b45309',source_trust:'#7c3aed'};
const BIPCOL={moral:'#1a8a4f',wisdom:'#7c5cff',faithfulness:'#2563eb',truthfulness:'#0e7490',repentance:'#b45309'};
function scoreBars(scores){
  if(!scores||!scores.length)return '';
  const byD={};scores.forEach(s=>byD[s.dimension]=s);
  const bip=(d)=>BIPCOL[d]!=null;
  const rows=['moral','wisdom','faithfulness','courage','truthfulness','repentance','historical_trust'].filter(d=>byD[d]).map(d=>{const s=byD[d];const v=+s.value;
    const kind=/curated/.test(s.method||'')?'curated':'computed';
    const vs=bip(d)?(v>0?'+':'')+v.toFixed(2):v.toFixed(2);
    const tip=('<b>'+SDIM[d]+'</b> &nbsp;'+vs+'<br><span style="color:#8a96a3;text-transform:uppercase;font-size:10px">'+kind+' · '+esc(s.method||'')+'</span><br>'+esc(s.basis||'(no basis recorded)')).replace(/"/g,'&quot;');
    const dt=' data-tip="'+tip+'"';
    const name='<div class="sname"'+dt+'>'+SDIM[d]+sigIcon(SDIM[d],s.basis,s.osis,v)+'</div>';
    if(bip(d)){const w=Math.abs(v)/2*100,left=v>=0?50:50-w,col=v>=0?BIPCOL[d]:'#c0392b';
      return name+'<div class="sbar bipolar"'+dt+'><span class="mid"></span><i style="left:'+left+'%;width:'+w+'%;background:'+col+'"></i></div><div class="sval" style="color:'+col+'"'+dt+'>'+vs+'</div>';}
    return name+'<div class="sbar"'+dt+'><i style="left:0;width:'+Math.round(v*100)+'%;background:'+SCOL[d]+'"></i></div><div class="sval"'+dt+'>'+v.toFixed(2)+'</div>';
  }).join('');
  return '<h3 class="muted" style="margin-top:16px">Character Profile</h3><div class="scores">'+rows+'</div>';
}

// ── hash routing: every view is a URL route so browser back/forward works ──
const TABS=['home','explore','classes','timeline','geo','oikos','generations','graph','validate','admin'];
let adminSection='';
function nav(h){if(('#'+h)===location.hash)applyHash();else location.hash=h;}
function markNav(t){document.querySelectorAll('nav button').forEach(x=>x.classList.toggle('on',x.dataset.t===t));}
function applyHash(){
  let h=decodeURIComponent(location.hash.replace(/^#/,''));if(!h)h='home';
  let i=h.indexOf('/'),t=i<0?h:h.slice(0,i),arg=i<0?'':h.slice(i+1);
  if(t==='overview')t='home';
  if(t==='node'){tab='explore';markNav('explore');if(document.getElementById('detail')){if(arg)renderNode(arg);}else{explore().then(()=>arg&&renderNode(arg));}return;}
  if(t==='graph'&&arg){graphCenter=arg;gExpand={};gFilters={};}
  if(t==='oikos'&&arg)oikosCenter=arg;
  if(t==='generations'&&arg)genRoot=arg;
  if(t==='admin')adminSection=arg||'';
  tab=TABS.includes(t)?t:'home';markNav(tab);render();
}
window.addEventListener('hashchange',applyHash);
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>nav(b.dataset.t));

// ── Bible book filter (header) — filters the Explore list by book→verse→entity ──
let bookFilter='',exploreRun=null,bookFacets={},redrawChips=null;
async function loadFacets(){if(!bookFilter){bookFacets={};}else{const d=await api('/bookfacets?book='+bookFilter);bookFacets=d.facets||{};}if(redrawChips)redrawChips();}
const BOOKS=[['Gen','Genesis'],['Exod','Exodus'],['Lev','Leviticus'],['Num','Numbers'],['Deut','Deuteronomy'],['Josh','Joshua'],['Judg','Judges'],['Ruth','Ruth'],['1Sam','1 Samuel'],['2Sam','2 Samuel'],['1Kgs','1 Kings'],['2Kgs','2 Kings'],['1Chr','1 Chronicles'],['2Chr','2 Chronicles'],['Ezra','Ezra'],['Neh','Nehemiah'],['Esth','Esther'],['Job','Job'],['Ps','Psalms'],['Prov','Proverbs'],['Eccl','Ecclesiastes'],['Song','Song of Solomon'],['Isa','Isaiah'],['Jer','Jeremiah'],['Lam','Lamentations'],['Ezek','Ezekiel'],['Dan','Daniel'],['Hos','Hosea'],['Joel','Joel'],['Amos','Amos'],['Obad','Obadiah'],['Jonah','Jonah'],['Mic','Micah'],['Nah','Nahum'],['Hab','Habakkuk'],['Zeph','Zephaniah'],['Hag','Haggai'],['Zech','Zechariah'],['Mal','Malachi'],['Matt','Matthew'],['Mark','Mark'],['Luke','Luke'],['John','John'],['Acts','Acts'],['Rom','Romans'],['1Cor','1 Corinthians'],['2Cor','2 Corinthians'],['Gal','Galatians'],['Eph','Ephesians'],['Phil','Philippians'],['Col','Colossians'],['1Thess','1 Thessalonians'],['2Thess','2 Thessalonians'],['1Tim','1 Timothy'],['2Tim','2 Timothy'],['Titus','Titus'],['Phlm','Philemon'],['Heb','Hebrews'],['Jas','James'],['1Pet','1 Peter'],['2Pet','2 Peter'],['1John','1 John'],['2John','2 John'],['3John','3 John'],['Jude','Jude'],['Rev','Revelation']];
(function(){const sel=document.getElementById('bookSel');if(!sel)return;sel.innerHTML='<option value="">All books</option>'+BOOKS.map(b=>'<option value="'+b[0]+'">'+b[1]+'</option>').join('');
  sel.onchange=async()=>{bookFilter=sel.value;await loadFacets();if(tab==='explore'){if(exploreRun)exploreRun();}else if(tab==='geo'||tab==='timeline'){nav(tab);}else nav('explore');};})();

// ── Connect: OIDC sign-in via the Impact central-auth home (mirrors demo-gs) ──
const CONNECT_DOMAIN='impact-agent.me',CLIENT_ID='bible-explorer',CENTRAL_AUTH_ORIGIN='https://www.'+CONNECT_DOMAIN,CONNECT_DELEGATE='0x89D13c596c45E4eE80Af5ae06C727FE9A820ffD0';
let session=null;
function loadSession(){try{const j=JSON.parse(localStorage.getItem('sa.session')||'null');session=(j&&j.exp*1000>Date.now())?j:null;if(!session)localStorage.removeItem('sa.session');}catch(e){session=null;}}
function isConnected(){return !!session;}
function b64url(b){let s='';for(let i=0;i<b.length;i++)s+=String.fromCharCode(b[i]);return btoa(s).split('+').join('-').split('/').join('_').replace(/=+$/,'');}
function fromB64url(seg){const bin=atob(seg.split('-').join('+').split('_').join('/'));const o=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)o[i]=bin.charCodeAt(i);return o;}
function decodeSeg(seg){return JSON.parse(new TextDecoder().decode(fromB64url(seg)));}
const randB64=(n)=>b64url(crypto.getRandomValues(new Uint8Array(n)));
async function pkce(){const v=randB64(32);const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v));return {verifier:v,challenge:b64url(new Uint8Array(d))};}
function nameLabel(n){let x=String(n||'').trim().toLowerCase();if(x.endsWith('.impact'))x=x.slice(0,-7);return x.split('.')[0];}
function authOriginFor(name){const l=nameLabel(name);return l?('https://'+l+'.'+CONNECT_DOMAIN):CENTRAL_AUTH_ORIGIN;}
function isAllowedIssuer(origin){try{const u=new URL(origin);if(u.protocol!=='https:'&&u.hostname!=='localhost'&&u.hostname!=='127.0.0.1')return false;if(u.pathname!=='/'&&u.pathname!=='')return false;if(u.search||u.hash)return false;const h=u.hostname;return h===CONNECT_DOMAIN||h.endsWith('.'+CONNECT_DOMAIN)||h==='localhost'||h==='127.0.0.1';}catch(e){return false;}}
async function connectStart(name){const state=randB64(16),nonce=randB64(16),pk=await pkce(),authOrigin=authOriginFor(name);
  sessionStorage.setItem('sa.pending',JSON.stringify({state,nonce,verifier:pk.verifier,authOrigin,name:name||''}));
  const u=new URL('/',authOrigin);u.searchParams.set('client_id',CLIENT_ID);u.searchParams.set('redirect_uri',location.origin+'/');u.searchParams.set('response_type','code');u.searchParams.set('scope','openid agent');u.searchParams.set('state',state);u.searchParams.set('nonce',nonce);u.searchParams.set('code_challenge',pk.challenge);u.searchParams.set('code_challenge_method','S256');u.searchParams.set('agent_name',name||'');u.searchParams.set('delegate',CONNECT_DELEGATE);u.searchParams.set('delegation_template','site-login');location.href=u.toString();}
// x402-pay budget connect: the reader approves a SPEND BUDGET once — the home mints an x402-pay payment
// delegation (payee = lbsb treasury, USDC, per-charge + session caps). Attached to the session as payDelegation.
const LBSB_TREASURY='0xa9e0acecfbce08548358b4f5681b13a00a5cab7a',LBSB_USDC='0x8fb56ff3C13347DFC4E1287aE83E88deE5a7211C';
// Two options, one mechanism (must mirror the a2a LBSB_TIERS): pay-as-you-go = a tiny pass; the
// subscription tiers = bigger passes at a volume discount. amount = atomic 6-dp mock USDC.
const LBSB_TIERS=[
  {id:'payg', label:'Pay-as-you-go', kind:'payg',         reads:5,   amount:'1000',  usdc:'0.001'},
  {id:'basic',label:'Basic',         kind:'subscription', reads:50,  amount:'8000',  usdc:'0.008'},
  {id:'plus', label:'Plus',          kind:'subscription', reads:500, amount:'60000', usdc:'0.06'}
];
const lbsbTier=(id)=>LBSB_TIERS.find(t=>t.id===id)||LBSB_TIERS[0];
// Buy access in a POPUP (seamless): the home opens in a small window, recognizes you via its 1-hour
// ap_sso session (no fresh login — just one signature to authorize the CHARGE), posts the code back, and
// closes. We stay on the Explorer. Popup blocked → full-redirect fallback (handled by connectCallback).
async function connectStartPay(ed,tierId){const state=randB64(16),nonce=randB64(16),pk=await pkce(),authOrigin=authOriginFor(session.name||'');const tier=lbsbTier(tierId);
  const u=new URL('/',authOrigin);u.searchParams.set('client_id',CLIENT_ID);u.searchParams.set('redirect_uri',location.origin+'/');u.searchParams.set('response_type','code');u.searchParams.set('scope','openid agent');u.searchParams.set('state',state);u.searchParams.set('nonce',nonce);u.searchParams.set('code_challenge',pk.challenge);u.searchParams.set('code_challenge_method','S256');u.searchParams.set('agent_name',session.name||'');u.searchParams.set('delegate',CONNECT_DELEGATE);u.searchParams.set('delegation_template','x402-pay');u.searchParams.set('pay_amount',tier.amount);
  const pend={state,nonce,verifier:pk.verifier,authOrigin,name:session.name||'',pay:1,ed:ed||'lbsb',tier:tier.id};
  const w=window.open(u.toString()+'&mode=popup','gc_pay','width=460,height=760,menubar=no,toolbar=no');
  if(!w){sessionStorage.setItem('sa.pending',JSON.stringify(pend));location.href=u.toString();return;} // blocked → redirect
  const homeOrigin=new URL(authOrigin).origin;
  function onMsg(ev){if(ev.origin!==homeOrigin&&ev.origin!==location.origin)return;const d=ev.data||{};
    if(d.type==='AC_SUCCESS'&&d.state===state){window.removeEventListener('message',onMsg);try{w.close();}catch(e){}exchangePayCode(pend,d.code);}
    else if(d.type==='AC_CANCEL'){window.removeEventListener('message',onMsg);try{w.close();}catch(e){}}}
  window.addEventListener('message',onMsg);
}
// Exchange the popup's auth code for the token (which carries the payment delegation + the in-ceremony
// charge's settlementHash), then claim the read pass — same as the redirect path, but the page never left.
async function exchangePayCode(pend,code){
  try{
    const base=pend.authOrigin.endsWith('/')?pend.authOrigin.slice(0,-1):pend.authOrigin;
    const tr=await fetch(base+'/token',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({grant_type:'authorization_code',code:code,code_verifier:pend.verifier,client_id:CLIENT_ID,redirect_uri:location.origin+'/'})}).then(r=>r.json());
    if(!tr.id_token)throw new Error(tr.error||'no id_token returned');
    await verifyIdToken(pend.authOrigin,tr.id_token,pend.nonce);
    const pd=tr.paymentDelegation||null;
    if(session){session.payDelegation=pd;localStorage.setItem('sa.session',JSON.stringify(session));}
    if(pd)await storePayDelegation(pd);
    if(tr.settlementHash){const cl=await a2aPost('/pay/claim',{id_token:session.idToken,edition:pend.ed||'lbsb',settlementHash:tr.settlementHash});
      if(cl&&cl.ok){toastPaidMsg('✓ paid '+(Number(cl.amount||0)/1e6)+' USDC · '+esc(cl.tierLabel||'access')+' · '+(cl.passUses||0)+'-read pass');if(typeof loadTreasury==='function')loadTreasury();}
      else{alert('Charged, but the read pass could not be minted ('+((cl&&cl.error)||'verify failed')+'). Try reading again.');}}
    hideLicenseGate();if(typeof applyHash==='function')applyHash();
  }catch(e){alert('Buy access failed: '+(e&&e.message?e.message:e));}
}
function toastPaidMsg(msg){let el=document.getElementById('paytoast');if(!el){el=document.createElement('div');el.id='paytoast';el.style.cssText='position:fixed;right:16px;bottom:16px;background:#136c3a;color:#fff;padding:10px 14px;border-radius:9px;font-size:13px;z-index:300;box-shadow:0 2px 12px rgba(0,0,0,.25)';document.body.appendChild(el);}el.innerHTML=msg;el.style.display='block';setTimeout(function(){if(el)el.style.display='none';},4000);}
function toastPaid(){toastPaidMsg('✓ paid · access added');}
// VAULT-BACKED budget: read the reader's x402-pay budget delegation (delegator = their nameless TREASURY
// SA) from THEIR vault — provisioned once by the home. The PERSON SA redeems it to pay (no per-mint).
async function loadPayBudget(){
  if(!isConnected()||!session.delegation)return null;
  try{
    const cj=await fetch(DEMO_A2A_BASE+'/auth/csrf',{credentials:'include'}).then(r=>r.json());const tok=cj.token||cj.csrfToken||cj.csrf||'';
    const r=await fetch(DEMO_A2A_BASE+'/mcp/vault/get',{method:'POST',credentials:'include',headers:{'content-type':'application/json','X-CSRF-Token':tok},body:JSON.stringify({delegation:session.delegation,requester:session.delegation.delegate,recordType:'x402-budget'})}).then(x=>x.json());
    const budget=(r&&(r.data||r.record))||null;
    if(budget){session.payDelegation=budget;localStorage.setItem('sa.session',JSON.stringify(session));}
    return budget;
  }catch(e){return null;}
}
// Persist the reader's x402-pay payment delegation (delegator = their person-treasury SA, delegate = OPEN,
// payee = lbsb treasury — minted ONCE by the home at connect) into THEIR OWN vault, so it survives sessions
// and the reader can redeem it (push) per paid read. Authorized by the reader's site-login delegation. The
// lbsb-treasury vault is reserved for future PULL/subscription delegations (where the provider redeems).
async function storePayDelegation(deleg){
  if(!deleg||!session||!session.delegation)return false;
  try{
    const cj=await fetch(DEMO_A2A_BASE+'/auth/csrf',{credentials:'include'}).then(r=>r.json());const tok=cj.token||cj.csrfToken||cj.csrf||'';
    const r=await fetch(DEMO_A2A_BASE+'/mcp/vault/set',{method:'POST',credentials:'include',headers:{'content-type':'application/json','X-CSRF-Token':tok},body:JSON.stringify({delegation:session.delegation,requester:session.delegation.delegate,recordType:'x402-budget',data:deleg})}).then(x=>x.json());
    return !!(r&&r.ok!==false);
  }catch(e){return false;}
}
// (Removed the SIWE-only client-side redemption — NO fallbacks. EVERY custodian charges the SAME way:
//  through the home connect ceremony (Buy access → chargePayment, signed via signHashFor for wallet/
//  passkey/social), which mints the access pass. The Explorer never signs a payment userOp.)
// (Removed the SIWE-only window.ethereum treasury mint — NO fallbacks. Funding is uniform for ALL
//  custodians: the home charge ceremony tops up the person-treasury (mints mock USDC, signed by the
//  reader's credential) before it charges, so "Buy access" funds + pays in one credential prompt.)
async function verifyIdToken(authOrigin,idToken,expectedNonce){
  const parts=idToken.split('.');if(parts.length!==3)throw new Error('id_token malformed');
  const header=decodeSeg(parts[0]),claims=decodeSeg(parts[1]);
  // Verify against the token's OWN issuer (the user's home) provided it's a valid Global.Church home.
  // An established user signing in at www gets a token issued by their personal *.impact-agent.me home,
  // so trusting claims.iss (allow-listed) rather than the origin we bounced through is correct.
  const iss=String(claims.iss||'');if(!isAllowedIssuer(iss))throw new Error('issuer not allowed: '+iss);
  const base=iss.endsWith('/')?iss.slice(0,-1):iss;
  const jwks=await fetch(base+'/jwks').then(r=>r.json());
  const jwk=(jwks.keys||[]).find(k=>k.kid===header.kid);if(!jwk)throw new Error('no JWKS key');
  if(jwk.alg!=='ES256'||header.alg!=='ES256')throw new Error('alg not ES256');
  const key=await crypto.subtle.importKey('jwk',jwk,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
  const ok=await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,fromB64url(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1]));
  if(!ok)throw new Error('signature invalid');
  if(claims.aud!==CLIENT_ID)throw new Error('aud mismatch');
  if(expectedNonce&&claims.nonce!==expectedNonce)throw new Error('nonce mismatch');
  if(typeof claims.exp!=='number'||claims.exp*1000<Date.now())throw new Error('id_token expired');return claims;}
async function connectCallback(){const p=new URLSearchParams(location.search);const code=p.get('code'),state=p.get('state');if(!code||!state)return false;
  let pend=null;try{pend=JSON.parse(sessionStorage.getItem('sa.pending')||'null');}catch(e){}
  history.replaceState(null,'',location.pathname+location.hash);
  if(!pend||pend.state!==state)return false;
  try{const tr=await fetch((pend.authOrigin.endsWith('/')?pend.authOrigin.slice(0,-1):pend.authOrigin)+'/token',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({grant_type:'authorization_code',code,code_verifier:pend.verifier,client_id:CLIENT_ID,redirect_uri:location.origin+'/'})}).then(r=>r.json());
    if(!tr.id_token)throw new Error(tr.error||'no id_token returned');
    const claims=await verifyIdToken(pend.authOrigin,tr.id_token,pend.nonce);
    if(pend.pay){
      // x402-pay connect — the home minted the person-treasury to lbsb-treasury payment delegation
      // (returned as tr.paymentDelegation, distinct from the site-login tr.delegation). Attach it to the
      // session AND persist it to the reader's vault so the reader can redeem it (push) per paid read.
      const pd=tr.paymentDelegation||null;
      if(session){session.payDelegation=pd;localStorage.setItem('sa.session',JSON.stringify(session));}
      if(pd)await storePayDelegation(pd);
      // The home ceremony may have CHARGED the first payment (all-custodian) and returned a settlementHash.
      // Claim it → the a2a verifies on-chain + mints the reader's access pass. This is what makes passkey/
      // social work (the charge was signed by the reader's credential at the home; no Explorer wallet sig).
      if(tr.settlementHash){
        try{
          const cl=await a2aPost('/pay/claim',{id_token:session.idToken,edition:pend.ed||'lbsb',settlementHash:tr.settlementHash});
          if(cl&&cl.ok){toastPaidMsg('✓ paid '+(Number(cl.amount||0)/1e6)+' USDC · '+esc(cl.tierLabel||'access')+' · '+(cl.passUses||0)+'-read pass');if(typeof loadTreasury==='function')loadTreasury();}
        }catch(e){}
      }
      sessionStorage.removeItem('sa.pending');hideLicenseGate();if(typeof applyHash==='function')applyHash();return true;
    }
    session={idToken:tr.id_token,delegation:tr.delegation||null,name:claims.agent_name||pend.name||'',sub:claims.canonical_agent_id||claims.sub||'',exp:claims.exp};
    localStorage.setItem('sa.session',JSON.stringify(session));sessionStorage.removeItem('sa.pending');return true;
  }catch(e){alert('Connect failed: '+(e&&e.message?e.message:e));sessionStorage.removeItem('sa.pending');return false;}}
function disconnect(){session=null;localStorage.removeItem('sa.session');renderConnect();}
function closeConnectGate(){const m=document.getElementById('connectGate');if(m)m.style.display='none';}
function openConnectGate(reason){const m=document.getElementById('connectGate');if(!m)return;
  document.getElementById('cg-body').innerHTML=
   '<div class="cg-globe">🌐</div>'+
   '<h2 style="margin:6px 0 2px">Connect with Global.Church</h2>'+
   '<p class="muted" style="font-size:13px;line-height:1.5;margin:0 0 4px">Sign in through your Global.Church home. Bible Explorer only receives the access you approve, and your contact details stay private until you accept a connection.'+(reason?'<br><br>Connect to <b>'+esc(reason)+'</b>.':'')+'</p>'+
   '<div class="muted" style="font-size:11px;margin-bottom:14px">One identity · roles are just views</div>'+
   '<button class="cg-go" onclick="closeConnectGate();connectStart(\\'\\')">🌐 Continue with Global.Church</button>'+
   '<button class="cg-back" onclick="closeConnectGate()">← Back</button>';
  m.style.display='flex';}
function promptConnect(){openConnectGate('');}
function requireConnect(action){if(isConnected())return true;openConnectGate(action);return false;}
function renderConnect(){const el=document.getElementById('connectBtn');if(!el)return;
  if(!isConnected()){el.innerHTML='<button class="map-basbtn on" style="border:1px solid var(--accent);border-radius:8px" onclick="promptConnect()">Connect</button>';return;}
  const nm=esc(session.name||(session.sub||'').slice(0,16));const did=esc(session.sub||'');
  el.innerHTML='<div class="acctmenu"><button class="acctmenu-trigger" onclick="toggleAcctMenu(event)"><span class="acctmenu-dot">●</span><span class="acctmenu-lbl">'+nm+'</span><span class="acctmenu-caret">▾</span></button>'+
   '<div class="acctmenu-pop" id="acctmenuPop"><div class="acctmenu-head"><div class="acctmenu-name">'+nm+'</div><div class="acctmenu-did mono">'+did+'</div></div>'+
   '<button class="acctmenu-item" onclick="closeAcctMenu();nav(\\'admin\\')">My account</button>'+
   '<button class="acctmenu-item danger" onclick="closeAcctMenu();disconnect()">Disconnect</button></div></div>';}
function toggleAcctMenu(e){if(e){e.stopPropagation();}const p=document.getElementById('acctmenuPop');if(p)p.classList.toggle('open');}
function closeAcctMenu(){const p=document.getElementById('acctmenuPop');if(p)p.classList.remove('open');}
document.addEventListener('click',function(e){const p=document.getElementById('acctmenuPop');if(p&&p.classList.contains('open')&&!e.target.closest('.acctmenu'))p.classList.remove('open');});
// Popup relay (spec 257): if the Buy-access popup lost its opener to COOP, the home redirects it HERE with
// ?ac_relay=1&code&state. We're that popup → hand the code to our opener (the main Explorer) and close.
(function(){try{var rp=new URLSearchParams(location.search);if(rp.get('ac_relay')==='1'&&rp.get('code')&&window.opener){window.opener.postMessage({type:'AC_SUCCESS',code:rp.get('code'),state:rp.get('state')},location.origin);window.close();}}catch(e){}})();
// Single render path: when returning from a connect/Buy-access redirect (?code), DON'T paint gated
// content until connectCallback finishes (it exchanges the code + claims the pass) — otherwise the reads
// race the async claim and flash 402s. Normal load: connectCallback resolves immediately → render now.
loadSession();renderConnect();updateSrcUI();connectCallback().then(ok=>{if(ok)renderConnect();applyHash();});

// ── Home gateway ──
const SVG_MAP='<svg viewBox="0 0 200 92" preserveAspectRatio="xMidYMid slice"><rect width="200" height="92" fill="#e9eef6"/><path d="M30 8 Q60 28 52 58 T78 90" stroke="#a9bdda" fill="none" stroke-width="2"/><path d="M128 4 Q116 40 138 72" stroke="#a9bdda" fill="none" stroke-width="2"/>'+[[55,30],[72,55],[100,40],[128,24],[145,60],[92,74],[44,18]].map(p=>'<circle cx="'+p[0]+'" cy="'+p[1]+'" r="4" fill="#2f6df0"/>').join('')+'</svg>';
const SVG_TL='<svg viewBox="0 0 200 92">'+[['#2563eb',24,86],['#0e7490',46,118],['#b45309',74,78],['#1a8a4f',104,66],['#9333ea',142,46]].map((b,i)=>'<rect x="'+b[1]+'" y="'+(14+i*15)+'" width="'+b[2]+'" height="9" rx="3" fill="'+b[0]+'"/>').join('')+'<line x1="12" y1="8" x2="12" y2="86" stroke="#cbd5e1"/></svg>';
const SVG_RING='<svg viewBox="0 0 200 92"><g transform="translate(100,46)">'+[40,28,16].map(r=>'<circle r="'+r+'" fill="none" stroke="#cbd5e1" stroke-dasharray="2 3"/>').join('')+[[0,-38],[33,-18],[36,18],[0,38],[-33,18],[-36,-18]].map(p=>'<circle cx="'+p[0]+'" cy="'+p[1]+'" r="5" fill="#0d9488"/>').join('')+'<circle r="9" fill="#2f6df0"/></g></svg>';
const SVG_TREE='<svg viewBox="0 0 200 92">'+['M100 18 L50 50','M100 18 L100 50','M100 18 L150 50','M50 50 L36 80','M50 50 L64 80','M150 50 L150 80'].map(d=>'<path d="'+d+'" stroke="#cbd5e1" fill="none"/>').join('')+[[100,18,7,'#2f6df0'],[50,50,5,'#9333ea'],[100,50,5,'#9333ea'],[150,50,5,'#9333ea'],[36,80,4,'#2563eb'],[64,80,4,'#2563eb'],[150,80,4,'#2563eb']].map(n=>'<circle cx="'+n[0]+'" cy="'+n[1]+'" r="'+n[2]+'" fill="'+n[3]+'"/>').join('')+'</svg>';
const SVG_EGO=(()=>{const p=[[0,-34,'#0e7490'],[32,-18,'#b45309'],[37,8,'#1a8a4f'],[20,32,'#9333ea'],[-20,32,'#c0392b'],[-37,8,'#0d9488'],[-32,-18,'#2563eb']];return '<svg viewBox="0 0 200 92"><g transform="translate(100,46)">'+p.map(x=>'<line x1="0" y1="0" x2="'+x[0]+'" y2="'+x[1]+'" stroke="#dbe2ec"/>').join('')+p.map(x=>'<circle cx="'+x[0]+'" cy="'+x[1]+'" r="5" fill="'+x[2]+'"/>').join('')+'<circle r="10" fill="#2f6df0"/></g></svg>';})();
const SVG_SEARCH='<svg viewBox="0 0 200 92"><rect x="28" y="34" width="118" height="24" rx="12" fill="#fff" stroke="#cbd5e1"/><text x="42" y="50" font-size="11" fill="#9aa7b6">Jesus…</text><circle cx="160" cy="46" r="11" fill="none" stroke="#2f6df0" stroke-width="3"/><line x1="168" y1="54" x2="178" y2="64" stroke="#2f6df0" stroke-width="3"/></svg>';
async function home(){
  const TILES=[['geo','Map','1,758 geolocated places · activities · time animation',SVG_MAP],['timeline','Timeline','4200 BC – 90 AD · lifespans + activities',SVG_TL],['oikos','Oikos','Relationship rings · family · household · network',SVG_RING],['generations','Generations','Descent · discipleship · church plants',SVG_TREE],['graph','Trust Graph','Entity relationships · character signals',SVG_EGO],['explore','Explore','Search 6,800+ entities · read the verses',SVG_SEARCH]];
  V.innerHTML='<div class="gw-hero"><h2>Explore the Bible as a living graph</h2><p class="lead">People, places, events, relationships — and the verses behind them — across all 66 books.</p>'+
   '<input id="hq" class="gw-search-in" placeholder="Search people, places, events… (e.g. Jesus, Jerusalem, Exodus)"/>'+
   '<div class="gchips" id="hkf" style="margin-top:10px"></div><div id="hres"></div></div>'+
   '<div class="gw-grid">'+TILES.map(t=>'<div class="gw-tile" onclick="nav(\\''+t[0]+'\\')"><div class="gw-preview">'+t[3]+'</div><div class="gw-label">'+esc(t[1])+'</div><div class="gw-desc">'+esc(t[2])+'</div></div>').join('')+'</div>'+
   '<div class="sec-head">Featured people</div><div class="gw-feat" id="hfeat"><span class="ghint">loading…</span></div>';
  let hk='';const KF=[['','All'],['person','People'],['organization','Orgs'],['activity','Activities'],['place','Places']];
  const drawKf=()=>{document.getElementById('hkf').innerHTML=KF.map(k=>'<span class="gchip'+(hk===k[0]?' on':'')+'" data-k="'+k[0]+'">'+esc(k[1])+'</span>').join('');document.querySelectorAll('#hkf [data-k]').forEach(ch=>ch.onclick=()=>{hk=ch.dataset.k;drawKf();runH();});};
  drawKf();
  const hq=document.getElementById('hq');hq.focus();
  const runH=async()=>{const term=hq.value.trim(),r=document.getElementById('hres');if(term.length<2&&!hk){r.innerHTML='';return;}const d=await api('/search?q='+encodeURIComponent(term)+(hk?'&kind='+hk:''));r.innerHTML='<ul class="list" style="margin-top:10px">'+d.results.slice(0,8).map(x=>'<li onclick="showNode(\\''+x.id+'\\')">'+(x.image_thumb?'<img class="mini" loading="lazy" src="'+esc(x.image_thumb)+'"/>':dot(x.kind))+'<b>'+esc(x.label)+'</b> <span class="muted">'+(x.disambig?esc(x.disambig)+' · ':'')+esc(x.prov_class||x.gc_class||'')+'</span></li>').join('')+'</ul>';};
  let t;hq.oninput=()=>{clearTimeout(t);t=setTimeout(runH,160);};
  const ov=await api('/overview').catch(()=>({}));const tot=(ov&&ov.totals)||{};
  const bs=document.getElementById('brandsub');if(bs)bs.textContent=(tot.nodes?tot.nodes.toLocaleString()+' entities · ':'')+'1,758 places · 66 books';
  const feats=await Promise.all(['Jesus','Paul','Abraham','David','Mary'].map(n=>api('/search?q='+n+'&kind=person').catch(()=>({}))));
  document.getElementById('hfeat').innerHTML=feats.map(d=>{const r=(d.results||[]).find(x=>x.image_thumb)||(d.results||[])[0];if(!r)return '';return '<div class="gw-fc" onclick="showNode(\\''+r.id+'\\')">'+(r.image_thumb?'<img loading="lazy" src="'+esc(r.image_thumb)+'"/>':'<div style="height:70px"></div>')+'<div class="fn">'+esc(r.label)+'</div><div class="fk">'+esc(r.kind)+'</div></div>';}).join('')||'<span class="ghint">—</span>';
}

// ── verse passage popup: click a verse ref → read it with its logically-grouped surrounding verses ──
function prettyRef(a,b){const x=a.split('.'),y=b.split('.');if(x[0]===y[0]&&x[1]===y[1])return x[0]+' '+x[1]+':'+x[2]+(x[2]!==y[2]?'–'+y[2]:'');if(x[0]===y[0])return x[0]+' '+x[1]+':'+x[2]+' – '+y[1]+':'+y[2];return a+' – '+b;}
async function openPassage(osis){
  const m=document.getElementById('vmodal');m.className='vmodal on';
  m.innerHTML='<div class="box"><span class="x" onclick="closePassage()">×</span><div class="ghint">loading '+esc(osis)+'…</div></div>';
  m.onclick=(e)=>{if(e.target===m)closePassage();};
  let d;try{d=await fetch(A2A_BASE+'/passage?osis='+encodeURIComponent(osis)).then(r=>r.json());}catch(e){d={ok:false};}
  const box=m.querySelector('.box');if(!box)return;
  if(!d.ok||!d.verses||!d.verses.length){box.innerHTML='<span class="x" onclick="closePassage()">×</span><div class="ghint">No text available for '+esc(osis)+'.</div>';return;}
  const head=prettyRef(d.verses[0].osis,d.verses[d.verses.length-1].osis);
  const body=d.verses.map(v=>'<div class="vrow'+(v.osis===osis?' hot':'')+'"><span class="vn">'+esc(v.osis.split('.')[2])+'</span>'+esc(v.text)+'</div>').join('');
  box.innerHTML='<span class="x" onclick="closePassage()">×</span><h3>'+esc(head)+'</h3><div class="muted" style="font-size:11px;margin-bottom:10px">Berean Standard Bible (public domain) · paragraph context</div>'+body;
  box.scrollTop=0;const hot=box.querySelector('.vrow.hot');if(hot)setTimeout(()=>hot.scrollIntoView({block:'center'}),40);
}
function closePassage(){const m=document.getElementById('vmodal');if(m)m.className='vmodal';}
let geoImgFull={},detImgFull='';
function openImg(u){if(!u)return;const m=document.getElementById('imgmodal'),i=document.getElementById('imgmodalImg');if(!m||!i)return;i.src=u;m.style.display='flex';}
function openImgFor(id){openImg(geoImgFull[id]);}
function closeImg(){const m=document.getElementById('imgmodal');if(m)m.style.display='none';}
function pageTop(){window.scrollTo({top:0,behavior:'smooth'});}
// ── Signal Court: challenge a trust signal (AI agent review) + public feedback ──
let curNodeId='',curNodeLabel='',scSig=null,scAnalysis='',scVerdict='';
function sigIcon(kind,basis,osis,val){return '<span class="sigq" data-s="'+encodeURIComponent(JSON.stringify({id:curNodeId,label:curNodeLabel,kind:kind,basis:basis||'',osis:osis||'',val:val}))+'" onclick="openSignalCourt(this);event.stopPropagation()" title="challenge / discuss this signal">⚖</span>';}
function mdLite(t){return esc(String(t)).replace(/^#{1,6}\\s*(.+)$/gm,'<b>$1</b>').replace(/^\\s*[-*]\\s+/gm,'• ').replace(/^---+$/gm,'').replace(/\\*\\*([^*]+)\\*\\*/g,'<b>$1</b>').split('\\n').join('<br>');}
function openSignalCourt(el){let p;try{p=JSON.parse(decodeURIComponent(el.dataset.s));}catch(e){return;}scSig=p;const m=document.getElementById('sigcourt');if(!m)return;
  document.getElementById('sc-body').innerHTML=
   '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px"><div><b style="font-size:16px">'+esc(p.label)+'</b><div class="muted" style="font-size:12px">'+esc(p.kind)+' signal</div></div><span onclick="closeSigCourt()" style="cursor:pointer;font-size:22px;line-height:1;color:#94a3b8">×</span></div>'+
   '<div class="sc-claim">“'+esc(p.basis)+'”'+(p.osis?' &nbsp;<a class="vref" onclick="openPassage(\\''+esc(p.osis)+'\\')" style="text-decoration:underline;cursor:pointer">'+esc(p.osis)+' ↗</a>':'')+'</div>'+
   '<button class="gchip on" id="sc-go" onclick="sigAnalyze()" style="cursor:pointer;align-self:flex-start">🤖 Challenge with the trust agent</button>'+
   '<div id="sc-out"></div>'+
   '<h3 class="muted" style="margin:16px 0 6px">Public feedback</h3><div id="sc-fb"><div class="muted" style="font-size:12px">loading…</div></div>'+
   '<div class="sc-form">'+
     '<div class="gchips" id="sc-stance"><span class="gchip mini on" data-st="challenge">⚑ Challenge</span><span class="gchip mini" data-st="agree">✓ Agree</span><span class="gchip mini" data-st="note">✎ Note</span></div>'+
     '<div class="muted" id="sc-as" style="font-size:12px"></div>'+
     '<textarea id="sc-comment" rows="3" placeholder="Why is this signal right or wrong? Cite verses…"></textarea>'+
     '<button class="gchip on" id="sc-post" onclick="sigFeedbackSubmit()" style="cursor:pointer;align-self:flex-start">Post feedback →</button>'+
     '<div id="sc-status" style="font-size:12px;min-height:16px"></div>'+
   '</div>';
  m.style.display='flex';
  document.querySelectorAll('#sc-stance [data-st]').forEach(s=>s.onclick=()=>{document.querySelectorAll('#sc-stance [data-st]').forEach(x=>x.classList.remove('on'));s.classList.add('on');});
  scAnalysis='';scVerdict='';
  {const a=document.getElementById('sc-as');if(a)a.innerHTML='posting as <b>'+esc(isConnected()?(session.name||(session.sub||'').slice(0,14)):'(connect to post)')+'</b>'+(isConnected()?' <span style="color:#1a8a4f">— as a signed feedback assertion</span>':'');}
  loadSigFeedback();}
function closeSigCourt(){const m=document.getElementById('sigcourt');if(m)m.style.display='none';}
async function sigAnalyze(){if(!requireConnect('challenge this signal'))return;const o=document.getElementById('sc-out'),b=document.getElementById('sc-go');if(b)b.textContent='🤖 reviewing…';o.innerHTML='<div class="ghint" style="padding:10px">the trust agent is weighing the signal against Scripture…</div>';
  let r;try{r=await fetch(A2A_BASE+'/analyze',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({subject_label:scSig.label,sig_kind:scSig.kind,basis:scSig.basis,osis:scSig.osis})}).then(x=>x.json());}catch(e){r={analysis:'Could not reach the trust agent.'};}
  const an=r.analysis||'(no analysis)';scAnalysis=an;const A=an.toUpperCase();
  scVerdict=(A.indexOf('INVALID')>=0||A.indexOf('DOES NOT SUPPORT')>=0||an.indexOf('❌')>=0)?'invalid':(A.indexOf('TIGHTEN')>=0||A.indexOf('ADJUST')>=0||an.indexOf('⚠️')>=0)?'adjust':'valid';
  if(b)b.textContent='🤖 Re-challenge';o.innerHTML='<div class="sc-analysis">'+mdLite(an)+'</div><div class="muted" style="font-size:11px;margin-top:5px">verdict captured: <b>'+scVerdict+'</b> — review/edit below and post it.</div>';
  const ta=document.getElementById('sc-comment');if(ta&&!ta.value.trim())ta.value=an;
  const st=scVerdict==='valid'?'agree':'challenge';document.querySelectorAll('#sc-stance [data-st]').forEach(x=>x.classList.toggle('on',x.dataset.st===st));}
async function loadSigFeedback(){if(!scSig)return;let d;try{d=await api('/feedback?subject='+encodeURIComponent(scSig.id)+'&basis='+encodeURIComponent(scSig.basis));}catch(e){d={feedback:[]};}const fb=d.feedback||[];
  document.getElementById('sc-fb').innerHTML=fb.length?fb.map(f=>'<div class="sc-fbitem"><span class="sc-st sc-'+esc(f.stance)+'">'+esc(f.stance)+'</span> '+(f.verdict?'<span class="sc-st" style="background:#475569">'+esc(f.verdict)+'</span> ':'')+'<b>'+esc(f.author||'anonymous')+'</b> '+(f.signed?'<span title="signed feedback assertion" style="color:#1a8a4f;font-size:11px">✓ signed</span> ':'')+'<span class="muted" style="font-size:11px">'+esc((f.created_at||'').slice(0,10))+'</span><div style="margin-top:2px;white-space:pre-wrap">'+esc(f.comment)+'</div></div>').join(''):'<div class="muted" style="font-size:12px">No feedback yet — be the first to weigh in.</div>';}
async function sigFeedbackSubmit(){if(!scSig)return;if(!requireConnect('post feedback'))return;
  const stEl=document.querySelector('#sc-stance .on'),stance=stEl?stEl.dataset.st:'note',comment=document.getElementById('sc-comment').value.trim();
  const stat=document.getElementById('sc-status'),btn=document.getElementById('sc-post');
  if(comment.length<2){if(stat)stat.innerHTML='<span style="color:#c0392b">Add a comment before posting.</span>';return;}
  if(!session||!session.sub){if(stat)stat.innerHTML='<span style="color:#c0392b">Connect first — no signed identity.</span>';return;}
  if(stat)stat.innerHTML='<span class="muted">signing &amp; posting your feedback assertion…</span>';if(btn){btn.disabled=true;btn.textContent='Posting…';}
  const action=scVerdict==='invalid'?'flag':scVerdict==='adjust'?'adjust':'keep';
  const payload={target:{entityId:scSig.id,entityLabel:scSig.label,signalKind:scSig.kind,basis:scSig.basis,verse:scSig.osis},stance:stance,verdict:scVerdict||'',comment:comment,agentRationale:scAnalysis||'',proposedCorrection:{action:action,note:''},author:{agentId:session.sub,name:session.name||''}};
  try{const res=await fetch(A2A_BASE+'/submit-feedback',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}).then(x=>x.json());
    if(!res||!res.ok)throw new Error((res&&res.error)||'the agent did not confirm');
    if(stat)stat.innerHTML='<span style="color:#1a8a4f;font-weight:600">✓ Posted — your signed feedback assertion was recorded'+(scVerdict?' (verdict: '+esc(scVerdict)+')':'')+'.</span>';
    document.getElementById('sc-comment').value='';scAnalysis='';
    await loadSigFeedback();
  }catch(e){if(stat)stat.innerHTML='<span style="color:#c0392b">✗ Could not post: '+esc(e&&e.message?e.message:String(e))+'</span>';}
  if(btn){btn.disabled=false;btn.textContent='Post feedback →';}}
function fullFromThumb(s){if(!s||s.indexOf('/img/')<0)return s;return s.replace('-thumb.jpg','.jpg').replace('-thumb.jpeg','.jpeg');}
function imgHover(src,ev){const m=document.getElementById('imghover'),i=document.getElementById('imghoverImg');if(!m||!i||!src)return;const f=fullFromThumb(src);if(i.getAttribute('src')!==f)i.src=f;m.style.display='block';imgHoverMove(ev);}
function imgHoverMove(ev){const m=document.getElementById('imghover');if(!m||m.style.display!=='block')return;const x=ev.clientX,y=ev.clientY,w=580,h=420;let l=x+18,t=y+18;if(l+w>innerWidth)l=Math.max(8,x-w-18);if(t+h>innerHeight)t=Math.max(8,innerHeight-h-8);m.style.left=l+'px';m.style.top=t+'px';}
function imgHoverOut(){const m=document.getElementById('imghover');if(m)m.style.display='none';}
document.addEventListener('keydown',(e)=>{if(e.key==='Escape')closePassage();});

async function render(){
  if(geoTimer){clearInterval(geoTimer);geoTimer=null;}
  if(geoMap&&tab!=='geo'){try{geoMap.remove();}catch(e){}geoMap=null;}
  if(tab==='home')return home();
  if(tab==='explore')return explore();
  if(tab==='classes')return classes();
  if(tab==='timeline')return timeline();
  if(tab==='geo')return geo();
  if(tab==='oikos')return oikos();
  if(tab==='generations')return generations();
  if(tab==='graph')return graph();
  if(tab==='validate')return validate();
  if(tab==='admin')return admin();
}
// ── Inheritance browser: a class + ALL its subclasses across every layer ──
let clsList=null,clsKids={},clsExp={},clsSel='';
const CLS_ROOTS=['prov:Agent','prov:Activity','prov:Entity','pplan:Plan','dns:Assertion','gc:Role'];
async function classes(){
  V.innerHTML='<div class="card"><div class="sec-head">Class browser · Global Church Ontology</div>'+
   '<p class="hint" style="margin:0 0 12px">Click a class to list its instances; expand <b>▸</b> to drill into subclasses. The Global Church Ontology extends PROV-O · P-Plan · EP-Plan · DOLCE+DnS.</p>'+
   '<div class="grid2"><div id="ctree"></div><div id="cout"></div></div></div>';
  if(!clsList){const d=await api('/classes');clsList=d.classes;clsKids={};clsList.forEach(c=>{if(c.parent)(clsKids[c.parent]=clsKids[c.parent]||[]).push(c);});}
  clsExp={'prov:Activity':true,'gc:BiblicalEvent':true,'prov:Agent':true};clsSel='gc:BiblicalEvent';
  drawTree();classQuery('gc:BiblicalEvent');
}
function drawTree(){
  const lbl=(c)=>(clsList.find(x=>x.curie===c)||{}).label||c;
  const render=(curie,depth)=>{const kids=(clsKids[curie]||[]).slice().sort((a,b)=>(a.label||'').localeCompare(b.label||''));const ex=clsExp[curie];
    let h='<div class="ctrow" style="padding:2px 0 2px '+(depth*15)+'px;white-space:nowrap">'+(kids.length?'<span class="ccaret" data-ex="'+esc(curie)+'">'+(ex?'▾':'▸')+'</span>':'<span class="ccaret"></span>')+'<a class="'+(clsSel===curie?'sel':'')+'" data-cls="'+esc(curie)+'">'+esc(lbl(curie))+'</a> <span class="mono muted" style="font-size:9px">'+esc(curie)+'</span></div>';
    if(ex)for(const k of kids)h+=render(k.curie,depth+1);
    return h;};
  document.getElementById('ctree').innerHTML='<div class="ctree">'+CLS_ROOTS.map(r=>render(r,0)).join('')+'</div>';
  document.querySelectorAll('#ctree [data-ex]').forEach(el=>el.onclick=(e)=>{e.stopPropagation();clsExp[el.dataset.ex]=!clsExp[el.dataset.ex];drawTree();});
  document.querySelectorAll('#ctree [data-cls]').forEach(el=>el.onclick=()=>{clsSel=el.dataset.cls;clsExp[clsSel]=true;drawTree();classQuery(clsSel);});
}
async function classQuery(curie){
  const out=document.getElementById('cout');out.innerHTML='<div class="hint">loading…</div>';
  const d=await api('/class?curie='+encodeURIComponent(curie));
  const sm='';
  out.innerHTML='<div class="hint" style="margin:12px 0"><b style="font-size:15px;color:var(--ink)">'+d.total.toLocaleString()+'</b> instances of <span class="mono">'+esc(curie)+'</span> + its <b>'+d.subclasses.length+'</b> subclasses &nbsp;<span class="mono muted">'+d.subclasses.map(esc).join(' · ')+'</span></div>'+
   '<ul class="list">'+d.results.map(r=>'<li onclick="showNodeTab(\\''+r.id+'\\')">'+(r.image_thumb?'<img class="mini'+sm+'" loading="lazy" src="'+esc(r.image_thumb)+'"/>':dot(r.kind))+'<b>'+esc(r.label)+'</b> <span class="muted">'+(r.disambig?esc(r.disambig)+' · ':'')+esc(r.prov_class||r.gc_class||'')+'</span>'+confDot(r.canon_confidence)+'</li>').join('')+'</ul>';
}
// ── Account: personal-vault sections (left menu) + data-integrity review ──
const ADMIN_SECTIONS=[
  {key:'profile',label:'Profile',render:secProfile},
  {key:'delegations',label:'Delegations',render:secDelegations},
  {key:'treasury',label:'Treasury',render:secTreasury},
  {key:'entitlements',label:'Entitlements',render:secEntitlements},
  {key:'access',label:'Access',render:secAccess},
  {key:'feedback',label:'Feedback',render:secFeedback},
  {key:'integrity',label:'Data integrity',render:secIntegrity}
];
function acctVload(){return isConnected()?'<div class="ghint" style="padding:8px">loading…</div>':'<div class="muted" style="font-size:13px">Connect (top-right) to view.</div>';}
function acctCard(title,hint,body){return '<div class="card"><h3 class="muted" style="margin-top:0">'+title+'</h3>'+(hint?'<p class="hint">'+hint+'</p>':'')+body+'</div>';}
function admin(){
  const sec=ADMIN_SECTIONS.find(s=>s.key===adminSection)||ADMIN_SECTIONS[0];
  const side=ADMIN_SECTIONS.map(s=>'<button class="acct-navb'+(s.key===sec.key?' on':'')+'" onclick="nav(\\'admin/'+s.key+'\\')">'+esc(s.label)+'</button>').join('');
  V.innerHTML='<div class="acct-layout"><nav class="acct-side">'+side+'</nav><div class="acct-main" id="acctpanel"></div></div>';
  sec.render();
}
const VAULT_HINT='Read live from <b>your own demo-mcp vault</b> through the demo-a2a relayer — authorized by the delegation your Global.Church home minted at sign-in (your app signs nothing). Demo PII is <b>mock fixtures</b>.';
function secProfile(){
  document.getElementById('acctpanel').innerHTML=acctCard('Profile · personal vault',VAULT_HINT,'<div id="acctview">'+acctVload()+'</div>');
  loadAccount();
}
function secDelegations(){
  document.getElementById('acctpanel').innerHTML=acctCard('Delegations','The delegation(s) your home minted at sign-in — what lets this app read your vault on your behalf, re-presented at each read (your app never signs).','<div id="delgview">'+acctVload()+'</div>');
  loadDelegations();
}
function secTreasury(){
  document.getElementById('acctpanel').innerHTML=acctCard('My treasury · pay-per-access wallet','Your associated treasury smart account and its mock-USDC balance — the wallet that pays the x402 per-access fee for licensed editions. The connect-time faucet tops it up.','<div id="treasview">'+acctVload()+'</div>');
  loadTreasury();
}
function secEntitlements(){
  document.getElementById('acctpanel').innerHTML=acctCard('Entitlements in your vault','Entitlements delivered to your personal demo-mcp vault at grant time (distinct from the issuer ledger). Held entitlements let you read gated verse text — presenter-bound and commitment-verified.','<div id="vaultents">'+acctVload()+'</div>');
  loadVaultEnts();
}
function secAccess(){
  document.getElementById('acctpanel').innerHTML=acctCard('My access · licensed editions','Request access to a licensed edition; the corpus owner approves and the signed <b>entitlement</b> is issued to you. Every read is <b>presenter-bound</b> (only you can use your entitlement) and commitment-verified.','<div id="accessview"><div class="muted" style="font-size:13px">'+(isConnected()?'loading…':'Connect (top-right) to request and view access.')+'</div></div>');
  loadAccess();
}
function secFeedback(){
  document.getElementById('acctpanel').innerHTML=acctCard('My feedback · signal challenges','Trust-signal feedback you have posted — each a <b>signed feedback assertion</b> (ERC-8004-style) authored by your connected identity, scoped to one (entity, signal, verse) triple. Post new feedback from <b>⚖ Signal Court</b> on any signal in the graph.','<div id="myfb">'+acctVload()+'</div>');
  loadMyFeedback();
}
function secIntegrity(){
  document.getElementById('acctpanel').innerHTML=acctCard('Data integrity','Every node records how confidently its data is bound to a canonical id. Native Theographic ids are rock-solid (1.0); brought-in data (Wikidata + images) is scored by match strength — exact-unique matches near 1.0, name-collision or label-mismatch matches lower. Suspect bindings are listed here for review, never hidden.',
    '<div id="ibands" class="gchips"></div>'+
    '<div class="hint" style="margin:8px 0">Show bindings at or below: '+
    '<select id="ithr"><option value="1">all brought-in</option><option value="0.9" selected>&lt; 0.90 (needs review)</option><option value="0.7">&lt; 0.70 (suspect)</option></select></div>'+
    '<div id="ilist"></div>');
  const thr=document.getElementById('ithr');thr.onchange=()=>loadIntegrity(thr.value);
  loadIntegrity(thr.value);
}
// The connected user's associated treasury smart account + its mock-USDC balance — the wallet that pays
// the x402 pay-per-access fee for licensed editions. Read live from the a2a /pay/treasury-status (which
// reads the on-chain ERC-20 balance). Until a dedicated treasury SA is provisioned this is the person SA.
async function loadTreasury(){
  const el=document.getElementById('treasview');if(!el)return;
  if(!isConnected()){el.innerHTML='<div class="muted" style="font-size:13px">Connect to view.</div>';return;}
  el.innerHTML='<div class="ghint" style="padding:8px">reading your treasury…</div>';
  try{
    const budget=session.payDelegation||await loadPayBudget();
    const treasury=(budget&&budget.delegator)||'';
    const r=await fetch(A2A_BASE+'/pay/treasury-status',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id_token:session.idToken,treasury:treasury||undefined})}).then(x=>x.json());
    if(!r||!r.ok){el.innerHTML='<div style="color:#c0392b;font-size:13px">Could not read treasury: '+esc((r&&r.error)||'unknown')+'</div>';return;}
    const addr=r.treasury||'';
    const provisioned=r.provisioned;
    const bal=r.configured?(r.usdc||'0'):null;
    el.innerHTML='<div class="acc-row"><span class="acc-st '+(provisioned?'acc-granted':'acc-pending')+'">'+(provisioned?'person-treasury':'person SA')+'</span> '+
      '<b>'+(bal===null?'—':(Number(bal).toLocaleString()+' mock USDC'))+'</b></div>'+
      '<div class="hint" style="margin-top:3px">treasury <span class="mono">'+esc(addr.slice(0,22))+'…</span>'+
      (bal===null?'<br><span class="muted">balance unavailable — RPC not configured</span>':'<br>Your person-treasury pays the per-access fee for licensed editions. <b>Buy access</b> tops it up (mints mock USDC) + charges in one credential prompt — same for a wallet, passkey, or social login.')+
      (provisioned?'':'<br><span class="muted">No person-treasury authorized yet — create one in your Global.Church Portal, then Buy access.</span>')+'</div>';
  }catch(e){el.innerHTML='<div style="color:#c0392b;font-size:13px">Could not read treasury: '+esc(e&&e.message?e.message:String(e))+'</div>';}
}
// The connected user's own trust-signal feedback (author_sub filter on the public feedback store).
async function loadMyFeedback(){
  const el=document.getElementById('myfb');if(!el)return;
  if(!isConnected()){el.innerHTML='<div class="muted" style="font-size:13px">Connect to view your feedback.</div>';return;}
  el.innerHTML='<div class="ghint" style="padding:8px">loading your feedback…</div>';
  try{
    const d=await api('/feedback?author='+encodeURIComponent(session.sub||''));
    const fb=(d&&d.feedback)||[];
    if(!fb.length){el.innerHTML='<div class="muted" style="font-size:13px">You have not posted any trust-signal feedback yet. Open a signal in the graph and use ⚖ Signal Court to weigh in.</div>';return;}
    el.innerHTML=fb.map(f=>'<div class="sc-fbitem"><span class="sc-st sc-'+esc(f.stance)+'">'+esc(f.stance)+'</span> '+(f.verdict?'<span class="sc-st" style="background:#475569">'+esc(f.verdict)+'</span> ':'')+'<b>'+esc(f.subject_label||f.subject_id||'')+'</b>'+(f.osis?' <span class="muted" style="font-size:11px">'+esc(f.osis)+'</span>':'')+' '+(f.signed?'<span title="signed feedback assertion" style="color:#1a8a4f;font-size:11px">✓ signed</span> ':'')+'<span class="muted" style="font-size:11px">'+esc((f.created_at||'').slice(0,10))+'</span><div style="margin-top:2px;white-space:pre-wrap;font-size:13px">'+esc(f.comment)+'</div>'+(f.sig_kind?'<div class="muted" style="font-size:11px;margin-top:3px">signal: '+esc(f.sig_kind)+(f.basis?' — '+esc(f.basis):'')+'</div>':'')+'</div>').join('');
  }catch(e){el.innerHTML='<div style="color:#c0392b;font-size:13px">Could not load your feedback: '+esc(e&&e.message?e.message:String(e))+'</div>';}
}
// Show the delegation(s) the connected user holds — the site-login grant their home minted at sign-in,
// which authorizes this app to read their vault on their behalf (re-presented per read; no app signing).
function loadDelegations(){
  const el=document.getElementById('delgview');if(!el)return;
  if(!isConnected()){el.innerHTML='<div class="muted" style="font-size:13px">Connect to view.</div>';return;}
  const d=session.delegation;
  if(!d){el.innerHTML='<div class="muted" style="font-size:13px">No delegation in your session — Disconnect &amp; Connect again to grant vault access.</div>';return;}
  const cav=((d.caveats)||(d.authority&&d.authority.caveats)||[]).length;
  el.innerHTML='<div class="acc-row"><span class="acc-st acc-granted">active</span> <b>site-login</b> <span class="muted" style="font-size:11px">'+cav+' caveat'+(cav===1?'':'s')+'</span></div>'+
   '<div class="hint" style="margin-top:3px">delegator <span class="mono">'+esc((d.delegator||'').slice(0,18))+'…</span> → delegate <span class="mono">'+esc((d.delegate||'').slice(0,18))+'…</span><br>Lets this app read your vault on your behalf; re-presented at each read, your app never signs.</div>';
}
// Read the entitlements DELIVERED to the user's personal demo-mcp vault (written at grant time as
// records of type entitlement:bsb:<edition>) — distinct from the issuer ledger. Via the relayer vault API.
async function loadVaultEnts(){
  const el=document.getElementById('vaultents');if(!el)return;
  if(!isConnected()){el.innerHTML='<div class="muted" style="font-size:13px">Connect to view.</div>';return;}
  if(!session.delegation){el.innerHTML='<div class="muted" style="font-size:13px">No delegation — reconnect to read your vault.</div>';return;}
  el.innerHTML='<div class="ghint" style="padding:8px">reading your vault…</div>';
  try{
    const cj=await fetch(DEMO_A2A_BASE+'/auth/csrf',{credentials:'include'}).then(r=>r.json());
    const tok=cj.token||cj.csrfToken||cj.csrf||'';
    const hdr={'content-type':'application/json','X-CSRF-Token':tok};
    const reqr=session.delegation.delegate;
    const lst=await fetch(DEMO_A2A_BASE+'/mcp/vault/list',{method:'POST',credentials:'include',headers:hdr,body:JSON.stringify({delegation:session.delegation,requester:reqr})}).then(x=>x.json());
    if(!lst||!lst.ok)throw new Error((lst&&(lst.detail||lst.error))||'vault list failed');
    const ents=(lst.records||[]).filter(r=>String(r.record_type||r.recordType||'').indexOf('entitlement:bsb:')===0);
    if(!ents.length){el.innerHTML='<div class="muted" style="font-size:13px">No entitlements delivered to your vault yet. When the corpus owner approves your request, the signed entitlement is written here automatically.</div>';return;}
    const got=await Promise.all(ents.map(r=>{const t=r.record_type||r.recordType;return fetch(DEMO_A2A_BASE+'/mcp/vault/get',{method:'POST',credentials:'include',headers:hdr,body:JSON.stringify({delegation:session.delegation,requester:reqr,recordType:t})}).then(x=>x.json()).then(g=>({t:t,upd:r.updated_at,vc:(g&&(g.data||g.record))||{}}));}));
    el.innerHTML=got.map(function(o){const ed=String(o.t).split('entitlement:bsb:').join('');const subj=(o.vc&&o.vc.credentialSubject)||{};const vu=subj.validUntil||o.vc.validUntil||'';const iss=o.vc&&o.vc.issuer||'';
      return '<div class="acc-row"><span class="acc-st acc-granted">✓ in vault</span> <b>'+esc(ed)+'</b>'+(vu?' <span class="muted" style="font-size:11px">until '+esc(String(vu).slice(0,10))+'</span>':'')+'</div>'+
        '<div class="hint" style="margin:2px 0 8px">record <span class="mono">'+esc(o.t)+'</span>'+(iss?' · issuer <span class="mono">'+esc(String(iss).slice(0,16))+'…</span>':'')+(subj.id?' · subject <span class="mono">'+esc(String(subj.id).slice(0,14))+'…</span>':'')+(o.upd?' · delivered '+esc(String(o.upd).slice(0,10)):'')+'</div>';}).join('');
  }catch(e){el.innerHTML='<div style="color:#c0392b;font-size:13px">Could not read vault entitlements: '+esc(e&&e.message?e.message:String(e))+'</div>';}
}
// ── My access: request + hold entitlements, do an entitled read — all via the Scripture Agent ──
let accessEnts=[];
const a2aPost=(p,b)=>fetch(A2A_BASE+p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}).then(r=>r.json());
// LBSB access-state badge for the Access view: free grant, prepaid pass (+ verse reads left), or locked.
function accBalanceHTML(via,rem){
  const body=via==='grant'?'<span class="acc-st acc-granted">✓ grant</span> free entitlement access to <b>LBSB</b>':(via==='prepaid'?'<span class="acc-st acc-granted">🎟 prepaid pass</span> <b>LBSB</b> · <b>'+esc(String(rem))+'</b> verse read'+(String(rem)==='1'?'':'s')+' left':'<span class="acc-st acc-pending">🔒 locked</span> no <b>LBSB</b> access yet');
  return body+(via!=='grant'?' <button class="map-basbtn" style="border:1px solid var(--line);border-radius:7px" onclick="buyLbsbAccess(\\'lbsb\\')">'+(via==='prepaid'?'Top up':'Buy access')+'</button>':'');
}
function setAccBalance(via,rem){const el=document.getElementById('acc-balance');if(el)el.innerHTML=accBalanceHTML(via,rem);}
async function loadAccess(){
  const el=document.getElementById('accessview');if(!el)return;
  if(!isConnected()){el.innerHTML='<div class="muted" style="font-size:13px">Connect (top-right) to request and view access.</div>';return;}
  el.innerHTML='<div class="ghint" style="padding:8px">loading your access…</div>';
  try{
    const r=await Promise.all([a2aPost('/my-entitlements',{id_token:session.idToken}),a2aPost('/my-requests',{id_token:session.idToken}),a2aPost('/pay/access',{id_token:session.idToken,edition:'lbsb'}).catch(function(){return{};})]);
    const held=(r[0]&&r[0].entitlements)||[],reqs=(r[1]&&r[1].requests)||[],acc=r[2]||{};accessEnts=held;
    const heldEd={},pendEd={};held.forEach(e=>heldEd[e.edition]=1);reqs.forEach(q=>{if(q.status==='pending')pendEd[q.edition]=1;});
    let h='';
    // LBSB access-state header (kept in sync after each verse read via setAccBalance).
    h+='<div class="acc-row" id="acc-balance" style="margin-bottom:9px">'+accBalanceHTML(acc.via,acc.remaining)+'</div>';
    if(held.length)h+='<div style="font-weight:600;font-size:13px;margin-bottom:3px">Entitlements held</div>'+held.map((e,i)=>'<div class="acc-row"><span class="acc-st acc-granted">✓ entitled</span> <b>'+esc(e.edition)+'</b> <span class="muted" style="font-size:11px">until '+esc((e.validUntil||'').slice(0,10))+'</span> <button class="map-basbtn" style="border:1px solid var(--line);border-radius:7px" onclick="accReadPrompt('+i+')">Read a verse →</button> <button class="map-basbtn" style="border:1px solid var(--line);border-radius:7px" onclick="accAsyncRead('+i+')" title="Read via the async A2A bus (spec 269)">async bus ↗</button></div>').join('');
    if(reqs.length)h+='<div style="font-weight:600;font-size:13px;margin:9px 0 3px">Requests</div>'+reqs.map(q=>'<div class="acc-row"><span class="acc-st acc-'+esc(q.status)+'">'+esc(q.status)+'</span> <b>'+esc(q.edition)+'</b> <span class="muted" style="font-size:11px">'+esc((q.created_at||'').slice(0,10))+'</span></div>').join('');
    if(!heldEd['demo-licensed']&&!pendEd['demo-licensed'])h+='<button class="cg-go" style="margin-top:11px;max-width:300px" onclick="accRequest(\\'demo-licensed\\')">Request access to demo-licensed</button>';
    // Always offer a verse reader for LBSB — works via a held grant OR your prepaid pass (no grant needed);
    // each verse draws 1 from the pass. No access yet ⇒ the read 402s and offers Buy access.
    h+='<div style="font-weight:600;font-size:13px;margin:13px 0 3px">Read licensed scripture (LBSB)</div>'+
       '<div class="acc-row"><input id="acc-ref" placeholder="John 3:16" value="John 3:16" style="max-width:190px;padding:6px 9px"> <button class="map-basbtn" style="border:1px solid var(--line);border-radius:7px" onclick="accReadRef()">Read a verse →</button> <span class="muted" style="font-size:11px">draws 1 from your prepaid pass (or uses a grant)</span></div>';
    h+='<div id="acc-read" style="margin-top:11px"></div>';
    el.innerHTML=h||'<div class="muted" style="font-size:13px">No access yet — request a licensed edition below.</div>';
    if(!h)el.innerHTML='<button class="cg-go" style="max-width:300px" onclick="accRequest(\\'demo-licensed\\')">Request access to demo-licensed</button>';
  }catch(e){el.innerHTML='<div style="color:#c0392b;font-size:13px">Could not load access: '+esc(e&&e.message?e.message:String(e))+'</div>';}
}
async function accRequest(edition){
  if(!requireConnect('request access'))return;
  const r=await a2aPost('/request-entitlement',{id_token:session.idToken,edition:edition,note:'requested from Bible Explorer',delegation:session.delegation||null}).catch(e=>({ok:false,error:String(e)}));
  if(r&&r.ok){alert('Request sent to the corpus owner (request #'+(r.requestId||'?')+'). It shows as pending until approved.');loadAccess();}
  else alert('Could not request access: '+((r&&r.error)||'failed'));
}
function accReadPrompt(i){const e=accessEnts[i];if(!e)return;const ref=prompt('Read which verse from '+e.edition+'?  e.g. John 3:16','John 3:16');if(ref)accReadInto(e.edition,ref.trim(),e.entitlement);}
// Read via the Access-view input — uses a held grant for LBSB if present, else the prepaid PASS (no VC).
function accReadRef(){const i=document.getElementById('acc-ref');const ref=((i&&i.value)||'John 3:16').trim();const g=accessEnts.find(e=>e.edition==='lbsb');accReadInto('lbsb',ref,g?g.entitlement:null);}
async function accRead(i,ref){const e=accessEnts[i];if(e)accReadInto(e.edition,ref,e.entitlement);}
async function accReadInto(edition,ref,entitlement){
  const out=document.getElementById('acc-read');if(!out)return;
  out.innerHTML='<div class="ghint" style="padding:8px">reading '+esc(ref)+' from '+esc(edition)+'…</div>';
  const body={id_token:session.idToken,reference:ref,edition:edition,entitlement:entitlement||undefined};
  let r=await a2aPost('/resolve-licensed',body).catch(er=>({ok:false,error:String(er)}));
  // x402 pay-per-verse: no grant + no pass ⇒ gated. ALL custodians do the SAME thing — top up via the home
  // ceremony (Buy access), which charges + mints a multi-read pass; then the read draws from the pass.
  if(r&&r.gated&&!r.ok){
    out.innerHTML='<div style="color:#b45309;font-size:13px">Payment required for '+esc(edition.toUpperCase())+'. <button class="map-basbtn" style="border:1px solid var(--line);border-radius:7px" onclick="buyLbsbAccess(\\''+esc(edition)+'\\')">Buy access</button> — your home charges the fee (one credential prompt) and grants a read pass. Then read again.</div>';
    return;
  }
  if(r&&r.ok){
    const meter=r.accessVia==='prepaid'?'<div class="muted" style="font-size:11px;margin-top:3px">📖 metered verse read · <b>'+esc(String(r.prepaidRemaining))+'</b> read'+(r.prepaidRemaining===1?'':'s')+' left on your pass</div>':'';
    out.innerHTML='<div class="acc-verse"><b>'+esc(ref)+'</b> <span class="muted">('+esc(edition)+')</span><br>'+esc(r.text||'')+(r.commitmentOk?'<div class="muted" style="font-size:11px;margin-top:5px">✓ commitment verified · presenter-bound read</div>':'')+meter+'</div>';
    // reflect the decrement in the persistent status bar + a toast (the licensed VERSE TEXT is the metered unit)
    if(r.accessVia==='prepaid'){accessBar('prepaid',String(r.prepaidRemaining));setAccBalance('prepaid',r.prepaidRemaining);toastPaidMsg('📖 verse read · '+esc(String(r.prepaidRemaining))+' left on your pass');}
    else if(r.accessVia==='grant'){accessBar('grant',null);setAccBalance('grant',null);}
  }
  else out.innerHTML='<div style="color:#c0392b;font-size:13px">Denied: '+esc((r&&r.error)||'failed')+'</div>';
}
// (Removed the old FAUCET-custodied per-use charge bolt-on. The x402 fee is now triggered by data access:
//  a gated read 402s, the reader settles by redeeming their stored treasury→treasury delegation, the gate
//  verifies on-chain and serves — see api()/lbsbSettle/submitRedemption. No held key, no side charge.)
// Read via the async A2A bus: fetch the scoped-grant spec the home must mint, then submit a
// get-gated-passage TASK to the BSB agent through the Scripture Agent (resolve-on-behalf).
async function accAsyncRead(i){
  const e=accessEnts[i],out=document.getElementById('acc-read');if(!e||!out)return;
  out.innerHTML='<div class="ghint" style="padding:8px">async bus: building the scoped grant + submitting a task to the corpus agent…</div>';
  const spec=await fetch(A2A_BASE+'/a2a-grant-spec?skill=get-gated-passage').then(r=>r.json()).catch(()=>null);
  const r=await a2aPost('/resolve-on-behalf',{id_token:session.idToken,reference:'John 3:16',edition:e.edition,entitlement:e.entitlement,delegation:session.delegation||{}}).catch(er=>({ok:false,error:String(er)}));
  const cav=(spec&&spec.caveats||[]).length;
  out.innerHTML='<div class="acc-verse"><b>Async A2A bus</b> <span class="muted">(spec 269)</span>'+
    '<div class="muted" style="font-size:12px;margin-top:4px">Scoped grant your Global.Church home must mint: delegate <span class="mono">'+esc((spec&&spec.delegate||'').slice(0,12))+'…</span>, target <span class="mono">'+esc((spec&&spec.recipientAgent||'').slice(0,12))+'…</span>, method <span class="mono">'+esc(spec&&spec.methodSelector||'?')+'</span> · '+cav+' caveats (targets+methods+timestamp).</div>'+
    '<div style="margin-top:7px;font-size:13px">Task submit → BSB agent: '+(r&&r.ok?('<span style="color:#1a8a4f">✓ queued — task <span class="mono">'+esc((r.taskId||'').slice(0,14))+'…</span> state <b>'+esc(r.state)+'</b></span>'):('<span style="color:#b45309">'+esc((r&&r.error)||'rejected')+'</span> — needs a home-minted scoped grant + BSB activation (RPC + claimed SA)'))+'</div></div>';
}
// Read the connected user's PII from THEIR demo-mcp vault, via the demo-a2a relayer, using the
// delegation their Global.Church home minted at sign-in (re-presented; no extra signature).
async function loadAccount(){
  const el=document.getElementById('acctview');if(!el)return;
  if(!isConnected()){el.innerHTML='<div class="muted" style="font-size:13px">Connect (top-right) to view your account.</div>';return;}
  if(!session.delegation){el.innerHTML='<div class="muted" style="font-size:13px">Your session has no delegation — Disconnect &amp; Connect again to grant vault access.</div>';return;}
  el.innerHTML='<div class="ghint" style="padding:8px">reading your vault…</div>';
  try{
    const cj=await fetch(DEMO_A2A_BASE+'/auth/csrf',{credentials:'include'}).then(r=>r.json());
    const tok=cj.token||cj.csrfToken||cj.csrf||'';
    const r=await fetch(DEMO_A2A_BASE+'/mcp/person/pii',{method:'POST',credentials:'include',headers:{'content-type':'application/json','X-CSRF-Token':tok},body:JSON.stringify({delegation:session.delegation,requester:session.delegation.delegate})}).then(x=>x.json());
    if(!r||!r.ok)throw new Error((r&&(r.detail||r.error))||'vault read failed');
    const rec=r.record||{};const ks=Object.keys(rec);
    el.innerHTML=(ks.length?'<table class="acct">'+ks.map(k=>'<tr><td class="muted">'+esc(k.split('_').join(' '))+'</td><td>'+esc(rec[k]==null?'—':String(rec[k]))+'</td></tr>').join('')+'</table>':'<div class="muted">No PII record.</div>')+
      '<div class="hint" style="margin-top:6px">subject <b>'+esc(r.subject_name||'')+'</b> <span class="mono">'+esc((r.subject||'').slice(0,16))+'…</span> · served by <span class="mono">'+esc(r.served_by||'demo-mcp')+'</span> · via delegation '+esc((session.delegation.delegator||'').slice(0,10))+'…→'+esc((session.delegation.delegate||'').slice(0,10))+'…</div>';
  }catch(e){el.innerHTML='<div style="color:#c0392b;font-size:13px">Could not read your vault: '+esc(e&&e.message?e.message:String(e))+'</div>'+
    '<div class="hint" style="margin-top:5px">For this to work, the deployed <b>demo-a2a</b> must allow-list this app\\'s origin (<span class="mono">'+esc(location.origin)+'</span>) in its <span class="mono">ALLOWED_ORIGINS</span> (CSRF + CORS).</div>';}
}
async function loadIntegrity(max){
  const d=await api('/integrity?max='+encodeURIComponent(max));
  document.getElementById('ibands').innerHTML=bandChips(d.bands);
  const sm='';
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
   '<div class="hint">character signals: '+(d.signals||[]).map(s=>'<span class="chip" style="'+(s.polarity==='positive'?'background:#e7f6ee;color:#1a8a4f':s.polarity==='negative'?'background:#fdeceA;color:#c0392b':'background:#fbf0e6;color:#b45309')+'">'+s.polarity+' '+s.n+'</span>').join(' ')+' &nbsp;·&nbsp; temporal: 525 dated nodes (OWL-Time)</div></div>'+
   (d.inheritance?'<div class="card"><h3 class="muted" style="margin-top:0">Inheritance · canonical portraits · character signals</h3>'+
    '<div class="hint" style="margin-bottom:10px">A query for <span class="mono">prov:Agent</span> resolves <b style="color:var(--ink)">'+d.inheritance.viaClosure.toLocaleString()+'</b> instances across its <b>'+d.inheritance.subclasses+'</b> subclasses (people <i>and</i> organizations) via the stored subclass closure — a naive exact-class match returns just <b>'+d.inheritance.naiveExact+'</b>. <a class="link" onclick="document.querySelector(\\'[data-t=classes]\\').click()">explore inheritance →</a></div>'+
    '<div class="grid">'+(d.scores||[]).map(s=>'<div class="stat"><div class="n">'+s.avg+'</div><div class="l">'+(SDIM[s.dimension]||s.dimension)+' · avg<br><span class="muted">'+s.n.toLocaleString()+' scored</span></div></div>').join('')+'</div>'+
    '<div class="hint"><b>'+(d.withImage||0)+'</b> canonical entities carry a portrait image.</div>'+
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
let expKind='person',expSort='',expTrust='',expPage=0,expSub='',expSubdim='';
const DSORTC={wisdom:'#7c5cff',faithfulness:'#2563eb',courage:'#0d9488',truthfulness:'#0e7490',repentance:'#b45309'};
function tind(r){let h='';
  if(r.dimval!=null&&DSORTC[expSort]){const v=+r.dimval,c=DSORTC[expSort];h+='<span class="tbadge" title="'+esc(expSort)+' signal" style="background:'+c+'1f;color:'+c+'">'+(v>0?'+':'')+v.toFixed(2)+' '+esc(expSort)+'</span>';}
  if(r.moral!=null){const v=+r.moral,c=v>0.15?'#1a8a4f':v<-0.15?'#c0392b':'#b45309';h+='<span class="tbadge" title="righteousness character signal" style="background:'+c+'1f;color:'+c+'">'+(v>0?'＋':v<0?'－':'~')+Math.abs(v).toFixed(2)+'</span>';}
  if(r.nsig>0)h+='<span class="muted" style="font-size:11px" title="'+r.nsig+' character signals">◴ '+r.nsig+'</span>';
  return h?'<span class="trow">'+h+'</span>':'';}
async function explore(){
  V.innerHTML='<div class="card"><input id="q" placeholder="Search by name or alias… (e.g. Peter, David, Jerusalem, Exodus)"/>'+
   '<div class="gchips" id="kfil" style="margin-top:10px"></div>'+
   '<div class="gchips" id="subfil" style="margin-top:6px;align-items:center"></div>'+
   '<div class="gchips" id="tctl" style="margin-top:6px;align-items:center;justify-content:flex-start"></div>'+
   '<div class="gchips" id="tctl2" style="margin-top:6px;align-items:center;justify-content:flex-start"></div>'+
   '<div id="res"></div></div><div id="detail"></div>';
  const q=document.getElementById('q');q.focus();
  const run=async(pick)=>{const term=q.value.trim();const res=document.getElementById('res');
    if(term.length<2&&!expKind&&!expTrust&&!bookFilter){res.innerHTML='';const det=document.getElementById('detail');if(det)det.innerHTML='';return;}
    const d=await api('/search?q='+encodeURIComponent(term)+(expKind?'&kind='+encodeURIComponent(expKind):'')+(expSub?'&sub='+encodeURIComponent(expSub)+'&subdim='+expSubdim:'')+(expSort?'&sort='+expSort:'')+(expTrust?'&trust='+expTrust:'')+(bookFilter?'&book='+bookFilter:'')+'&page='+expPage);
    const list=d.results.length?'<ul class="list">'+d.results.map(r=>{const aka=(r.aka||'').split('|').filter(f=>f&&f.toLowerCase()!==String(r.label||'').toLowerCase());return '<li onclick="showNode(\\''+r.id+'\\')">'+(r.image_thumb?'<img class="mini" loading="lazy" src="'+esc(r.image_thumb)+'" onmouseenter="imgHover(this.src,event)" onmousemove="imgHoverMove(event)" onmouseleave="imgHoverOut()"/>':dot(r.kind))+'<b>'+esc(r.label)+'</b>'+tind(r)+' '+(aka.length?'<span class="muted">a.k.a. '+aka.map(esc).join(', ')+'</span> ':'')+'<span class="muted">'+(r.disambig?esc(r.disambig)+' · ':'')+esc(r.prov_class||'')+(r.gc_class?' · '+esc(r.gc_class):'')+'</span>'+confDot(r.canon_confidence)+'</li>';}).join('')+'</ul>':'<div class="ghint">No matches'+(expKind||expTrust?' for this filter':'')+'.</div>';
    const pager=(d.more||expPage>0)?'<div class="gchips" style="margin-top:10px;align-items:center">'+(expPage>0?'<span class="gchip mini" id="pprev">← Prev</span>':'')+'<span class="muted" style="font-size:11px;margin:0 7px">page '+(expPage+1)+'</span>'+(d.more?'<span class="gchip mini" id="pnext">Next →</span>':'')+'</div>':'';
    res.innerHTML=list+pager;
    const pv=document.getElementById('pprev'),nx=document.getElementById('pnext');
    if(pv)pv.onclick=()=>{expPage=Math.max(0,expPage-1);run();};
    if(nx)nx.onclick=()=>{expPage++;run();};
    if(d.results.length===1&&expPage===0)renderNode(d.results[0].id);else{const det=document.getElementById('detail');if(det)det.innerHTML='';}
  };
  const SORTS=[['','Relevance'],['wisdom','Wisest'],['courage','Most courageous'],['faithfulness','Most faithful'],['truthfulness','Most truthful'],['repentance','Most repentant'],['signals','Most signals']];
  const TRUSTS=[['','All'],['pos','More'],['neg','Less']];
  const drawCtl=()=>{const showT=(expKind==='person'||expKind==='organization');
    document.getElementById('tctl').innerHTML=showT?('<span class="muted" style="font-size:11px;margin-right:3px">sort</span>'+SORTS.map(s=>'<span class="gchip mini'+(expSort===s[0]?' on':'')+'" data-s="'+s[0]+'">'+esc(s[1])+'</span>').join('')):'';
    document.getElementById('tctl2').innerHTML=showT?('<span class="muted" style="font-size:11px;margin-right:3px">righteousness</span>'+TRUSTS.map(t=>'<span class="gchip mini'+(expTrust===t[0]?' on':'')+'" data-tr="'+t[0]+'">'+esc(t[1])+'</span>').join('')):'';
    if(showT){document.querySelectorAll('#tctl [data-s]').forEach(ch=>ch.onclick=()=>{expSort=ch.dataset.s;expPage=0;drawCtl();run();});
    document.querySelectorAll('#tctl2 [data-tr]').forEach(ch=>ch.onclick=()=>{expTrust=ch.dataset.tr;expPage=0;drawCtl();run();});}};
  drawCtl();
  const KF=[['','All'],['person','People'],['organization','Orgs'],['activity','Activities'],['place','Places'],['concept','Roles & concepts']];
  const FKC={'':'#64748b',person:KC.person,organization:KC.organization,activity:KC.event,place:KC.place,deity:KC.deity,concept:KC.concept};
  const kc=document.getElementById('kfil');
  const drawChips=()=>{kc.innerHTML=KF.map(k=>{const c=FKC[k[0]]||'#64748b',on=expKind===k[0],cnt=bookFilter&&bookFacets[k[0]]!=null?' <span class="'+(on?'':'muted')+'" style="font-size:11px">'+bookFacets[k[0]]+'</span>':'';return '<span class="gchip'+(on?' on':'')+'" data-k="'+k[0]+'" style="'+(on?'background:'+c+';color:#fff;border-color:'+c:'border-color:'+c+'66')+'">'+(k[0]?'<span class="kdot" style="display:inline-block;vertical-align:middle;margin-right:5px;background:'+(on?'#fff':c)+'"></span>':'')+esc(k[1])+cnt+'</span>';}).join('');kc.querySelectorAll('[data-k]').forEach(ch=>ch.onclick=()=>{expKind=ch.dataset.k;q.value='';expPage=0;expSub='';expSubdim='';expSort='';expTrust='';drawChips();drawCtl();loadSubs();run();});};
  redrawChips=drawChips;
  const subLabel=(s)=>String(s).replace(/^[a-z]+:/,'');
  async function loadSubs(){const sf=document.getElementById('subfil');if(!sf)return;if(!expKind){sf.innerHTML='';return;}
    const d=await api('/subtypes?kind='+encodeURIComponent(expKind));expSubdim=d.dim||'';
    if(!d.subs||d.subs.length<2){sf.innerHTML='';return;}
    sf.innerHTML='<span class="muted" style="font-size:11px;margin-right:3px">type</span>'+'<span class="gchip mini'+(expSub===''?' on':'')+'" data-sub="">All</span>'+d.subs.map(s=>'<span class="gchip mini'+(expSub===s.val?' on':'')+'" data-sub="'+esc(s.val)+'">'+esc(subLabel(s.label))+' <span class="'+(expSub===s.val?'':'muted')+'">'+s.n+'</span></span>').join('');
    sf.querySelectorAll('[data-sub]').forEach(ch=>ch.onclick=()=>{expSub=expSub===ch.dataset.sub?'':ch.dataset.sub;expPage=0;loadSubs();run();});}
  drawChips();if(expKind)loadSubs();if(bookFilter)loadFacets();
  exploreRun=run;
  let timer;q.oninput=()=>{clearTimeout(timer);expPage=0;timer=setTimeout(run,180);};
  if(expKind||expTrust||bookFilter)run();
}
function showNode(id){nav('node/'+id);}
function showNodeTab(id){nav('node/'+id);}
function oikosFor(id){nav('oikos/'+id);}
function backCrumb(id,label){return id?'<div class="dcrumb"><a onclick="nav(\\'node/'+id+'\\')">← Back to '+esc(label||'entity')+' details</a></div>':'';}
function genMovementFor(id){genRels='gc:discipled,gc:planted';nav('generations/'+id);}
async function renderNode(id){
  const d=await api('/node/'+encodeURIComponent(id)+(bookFilter?'?book='+bookFilter:''));if(!d.ok)return;
  const n=d.node;curNodeId=n.id;curNodeLabel=n.label;const cls=[['prov',n.prov_class],['dul',n.dul_class],['org',n.org_class],['geo',n.geo_class],['aps',n.aps_class],['gc',n.gc_class]].filter(x=>x[1]);
  const ectx=(e)=>{let x='';try{const c=JSON.parse(e.ctx||'null');if(c){if(c.rel)x+=' <span class="muted">('+esc(c.rel)+')</span>';if(c.n)x+=' <span class="muted">×'+c.n+'</span>';if(c.osis)x+=' <a class="vref" onclick="openPassage(\\''+esc(c.osis)+'\\')" style="text-decoration:underline">'+esc(c.osis)+'</a>';else if(c.refs)x+=' '+c.refs.slice(0,3).map(o=>'<a class="vref" onclick="openPassage(\\''+esc(o)+'\\')" style="text-decoration:underline;font-size:11px">'+esc(o)+'</a>').join(' ');}}catch(z){}return x;};
  const grp=(arr,dir)=>{const by={};arr.forEach(e=>{(by[e.rel]=by[e.rel]||[]).push(e)});return Object.entries(by).map(([rel,es])=>'<div class="edge-grp"><div class="rel">'+esc(rel)+(dir==='in'?' (inverse)':'')+'</div>'+es.map(e=>'<span style="margin-right:10px;white-space:nowrap"><a onclick="showNode(\\''+e.id+'\\')">'+dot(e.kind)+esc(e.label)+'</a>'+ectx(e)+'</span>').join('')+'</div>').join('');};
  const geo=n.lat!=null?'<div class="hint">📍 '+n.lat+', '+n.long+' &nbsp;<span class="mono">'+esc(n.wkt||'')+'</span></div>':'';
  const ord=(y)=>y==null?'':('c. '+Math.abs(y)+(y<0?' BC':' AD'));
  const temporal=(()=>{let m={};try{m=JSON.parse(n.meta||'{}')}catch(z){}return m.lifespan?'<div class="hint">📅 Lived <b>'+m.lifespan+' years</b>'+(m.lifespanRef?' · <a class="vref" onclick="openPassage(\\''+esc(m.lifespanRef)+'\\')" style="text-decoration:underline;cursor:pointer">'+esc(m.lifespanRef)+'</a>':'')+' <span class="muted">(stated in Scripture)</span></div>':'';})();
  const sigCss=(p)=>p==='positive'?'background:#e7f6ee;color:#1a8a4f':p==='negative'?'background:#fdeceA;color:#c0392b':'background:#fbf0e6;color:#b45309';
  const sigs=(d.signals&&d.signals.length)?'<div style="margin-top:8px">'+d.signals.map(s=>'<span class="chip" style="'+sigCss(s.polarity)+'">'+(s.polarity==='positive'?'＋':s.polarity==='negative'?'－':'~')+' '+esc(s.basis)+(s.osis?' · <a class="vref" onclick="openPassage(\\''+esc(s.osis)+'\\')" style="text-decoration:underline;cursor:pointer">'+esc(s.osis)+'</a>':'')+sigIcon((s.polarity==='positive'?'+ Act':s.polarity==='negative'?'- Act':'~ Act'),s.basis,s.osis,s.polarity)+'</span>').join('')+'</div>':'';
  const det=document.getElementById('detail')||V;
  const ibName=bookFilter?((BOOKS.find(b=>b[0]===bookFilter)||[])[1]||bookFilter):'';
  const inBookN=bookFilter?(d.inBookCount!=null?d.inBookCount:d.verses.filter(v=>String(v).indexOf(bookFilter+'.')===0).length):0;
  const vlist=bookFilter?d.verses.slice().sort((a,b)=>(String(b).indexOf(bookFilter+'.')===0?1:0)-(String(a).indexOf(bookFilter+'.')===0?1:0)):d.verses;
  det.innerHTML='<div class="card"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px"><h2 style="margin:0">'+dot(n.kind)+esc(n.label)+'</h2><a class="link" onclick="pageTop()" style="font-weight:600;cursor:pointer;white-space:nowrap;font-size:13px;flex-shrink:0">↑ Back to top</a></div>'+idrow(n)+
   '<div style="margin:8px 0 12px;display:flex;gap:6px;flex-wrap:wrap;align-items:center"><span class="muted" style="font-size:11px;margin-right:2px">explore in →</span>'+
   '<span class="gchip" style="cursor:pointer" onclick="graphFor(\\''+n.id+'\\')">⬡ Graph</span>'+
   (n.kind==='person'?'<span class="gchip" style="cursor:pointer" onclick="oikosFor(\\''+n.id+'\\')">◎ Oikos</span>':'')+
   '<span class="gchip" style="cursor:pointer" onclick="nav(\\'generations/'+n.id+'\\')">⋔ Generations</span>'+
   (n.kind==='person'?'<span class="gchip" style="cursor:pointer" onclick="genMovementFor(\\''+n.id+'\\')">↳ Movement</span>':'')+'</div>'+
   portrait(n)+
   '<div style="margin:2px 0 6px;line-height:2">'+((d.classChain&&d.classChain.length)?d.classChain.map((c,i)=>'<span title="inheritance" style="font:11px ui-monospace,monospace;background:'+(i===d.classChain.length-1?'#dbe8ff;color:#1d4ed8;font-weight:700':'#eef2fb;color:#3a4a63')+';border-radius:5px;padding:2px 7px;white-space:nowrap">'+esc(c.curie)+'</span>').join('<span style="color:#94a3b8;margin:0 3px">›</span>'):cls.map(c=>'<span class="chip" style="background:#eef2fb;color:#3a4a63">'+c[0]+': '+esc(c[1])+'</span>').join(''))+'</div>'+temporal+geo+sigs+scoreBars(d.scores)+
   (d.out.length?'<h3 class="muted" style="margin-top:16px">Relationships</h3>'+grp(d.out,'out'):'')+
   (d.in.length?grp(d.in,'in'):'')+
   '<h3 class="muted" style="margin-top:16px">Attested in '+(d.verseCount!=null?d.verseCount:d.verses.length)+' verses <span style="font-weight:400;text-transform:none">· click to read'+(bookFilter?' · <b style="color:#7a5c00">'+inBookN+' in '+esc(ibName)+'</b>':'')+((()=>{let m={};try{m=JSON.parse(n.meta||'{}')}catch(z){}return m.verseMatch==='name'?' · matched by name (approximate)':'';})())+'</span></h3><div class="verses">'+vlist.map(v=>'<span class="vref'+(bookFilter&&String(v).indexOf(bookFilter+'.')===0?' bk':'')+'" onclick="openPassage(\\''+esc(v)+'\\')">'+esc(v)+'</span>').join('')+'</div>'+
   provHtml(d.sources,n.origin_source)+'</div>';
  const htip=document.getElementById('htip');
  det.querySelectorAll('[data-tip]').forEach(el=>{
    el.addEventListener('mouseenter',()=>{htip.style.display='block';htip.innerHTML=el.dataset.tip;});
    el.addEventListener('mousemove',ev=>{htip.style.left=Math.min(ev.clientX+14,innerWidth-290)+'px';htip.style.top=(ev.clientY+16)+'px';});
    el.addEventListener('mouseleave',()=>{htip.style.display='none';});
  });
  det.scrollIntoView({behavior:'smooth',block:'nearest'});
}
let graphCenter=null,gFilters={},gExpand={};
function graphFor(id){nav('graph/'+id);}
function famOf(rel){const m={'gc:hasParent':'family','gc:hasChild':'family','gc:hasSibling':'family','gc:hasPartner':'family','gc:hasRelative':'family','gc:companionOf':'role','gc:memberOf':'org','gc:hasMember':'org','gc:member':'org','gc:organization':'org','gc:membershipRole':'org','prov:wasAssociatedWith':'events','gc:holdsRole':'role','aps:hasSkill':'role','gc:bornAt':'place','gc:diedAt':'place','gc:authoredBy':'events','gc:addressedTo':'events','gc:hasSpeaker':'events','gc:hasAddressee':'events','gc:spokeTo':'events','dul:hasLocation':'place','pplan:isStepOfPlan':'events','pplan:isPrecededBy':'events','pplan:correspondsToStep':'events','dul:defines':'events','gc:prescribes':'events','gc:fulfills':'events'};return m[rel]||'role';}
const SECT={family:{label:'Family',color:'#e87c3e',a:[0,60],th:10},role:{label:'Role/Skill',color:'#0d9488',a:[60,120],th:8},events:{label:'Events',color:'#0e7490',a:[120,210],th:4},place:{label:'Places',color:'#b45309',a:[210,270],th:99},org:{label:'Organization',color:'#9333ea',a:[270,360],th:6}};
const FORD=['family','role','events','place','org'];
const sigCol={positive:'#1a8a4f',negative:'#c0392b',mixed:'#b45309'};
const ordYr=(y)=>y==null?'':('c. '+Math.abs(y)+(y<0?' BC':' AD'));
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
  V.innerHTML='<div class="card"><div id="gcrumb"></div><input id="gq" placeholder="Center on a person/org/event… (e.g. Jesus, Paul, Nation of Israel)"/><div id="gres"></div><div id="gwrap"></div></div><div id="gtip" class="gtip"></div>';
  const gq=document.getElementById('gq');
  let timer;gq.oninput=()=>{clearTimeout(timer);timer=setTimeout(async()=>{
    const r=document.getElementById('gres');
    if(gq.value.trim().length<2){r.innerHTML='';return;}
    const d=await api('/search?q='+encodeURIComponent(gq.value.trim()));
    r.innerHTML='<ul class="list">'+d.results.slice(0,8).map(x=>'<li data-pick="'+x.id+'">'+dot(x.kind)+esc(x.label)+' <span class="muted">'+(x.prov_class||'')+'</span></li>').join('')+'</ul>';
    r.querySelectorAll('[data-pick]').forEach(li=>li.onclick=()=>nav('graph/'+li.dataset.pick));
  },180);};
  if(!graphCenter){const d=await api('/search?q=Jesus');graphCenter=(((d.results||[]).find(x=>x.label==='Jesus'))||(d.results||[])[0]||{}).id;}
  drawGraph();
}
async function drawGraph(){
  const wrap=document.getElementById('gwrap');wrap.innerHTML='<div class="ghint">loading…</div>';
  const d=await api('/graph?center='+encodeURIComponent(graphCenter));if(!d.ok){wrap.innerHTML='<div class="ghint">could not load this node</div>';return;}
  const W=1040,H=560,cx=500,cy=280,center=d.center,byId={};d.nodes.forEach(n=>byId[n.id]=n);
  {const gc=document.getElementById('gcrumb');if(gc)gc.innerHTML=backCrumb(center,(byId[center]||{}).label);}
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
  const gfil='none';
  const ccirc=cn.img
    ?'<defs><clipPath id="cclip"><circle cx="'+cx+'" cy="'+cy+'" r="28"/></clipPath></defs><image href="'+esc(cn.img)+'" x="'+(cx-28)+'" y="'+(cy-28)+'" width="56" height="56" clip-path="url(#cclip)" preserveAspectRatio="xMidYMid slice" style="filter:'+gfil+'"/><circle cx="'+cx+'" cy="'+cy+'" r="28" fill="none" stroke="#2f6df0" stroke-width="3"/>'
    :'<circle cx="'+cx+'" cy="'+cy+'" r="28" fill="#2f6df0"/>';
  const clab='<text x="'+cx+'" y="'+(cn.img?cy+45:cy+4)+'" text-anchor="middle" font-size="'+(cn.img?11:(cn.label.length>8?9:12))+'" font-weight="700" fill="'+(cn.img?'#1f2733':'#fff')+'">'+esc(cn.label.length>16?cn.label.slice(0,15)+'…':cn.label)+'</text>';
  s+='<g class="gnode gcenter" data-id="'+center+'">'+ccirc+badge(cx,cy,28,cn.sig)+clab+'</g></svg>';
  const tline=cn.tStart!=null?' · '+ordYr(cn.tStart)+(cn.tEnd!=null&&cn.tEnd!==cn.tStart?'–'+ordYr(cn.tEnd):''):'';
  let chips='';FORD.forEach(f=>{const on=!gFilters[f];chips+='<span class="gchip'+(on?' on':'')+'" data-fam="'+f+'"'+(on?' style="background:'+SECT[f].color+';color:#fff;border-color:'+SECT[f].color+'"':'')+'>'+SECT[f].label+'</span>';});
  const legend='<div class="glegend">'+[['person','person'],['organization','org'],['event','event'],['place','place'],['role','role']].map(k=>dot(k[0])+k[1]).join(' ')+' &nbsp;·&nbsp; ◇ event ▽ place ⬡ role ☐ org &nbsp;·&nbsp; <span style="color:#1a8a4f">＋</span>/<span style="color:#c0392b">－</span> character signal</div>';
  wrap.innerHTML='<div class="gbread"><b>'+dot(cn.kind)+esc(cn.label)+'</b> <span class="muted">'+cn.kind+tline+' · '+d.edges.length+' relationships</span> · <a class="link" data-details="1">details ↗</a></div><div class="gchips">'+chips+'</div>'+s+legend+'<div class="ghint">Hover a node to isolate its relationship · click a node to recenter · click a cluster pill to expand · toggle a family above to filter.</div>';
  const svg=document.getElementById('gsvg'),tip=document.getElementById('gtip');
  wrap.querySelectorAll('.gnode').forEach(g=>{const id=g.dataset.id;
    g.addEventListener('mouseenter',()=>{svg.classList.add('dim');g.classList.add('hot');
      svg.querySelectorAll('.gedge').forEach(e=>{if(e.dataset.a===id||e.dataset.b===id){e.classList.add('hot');const o=e.dataset.a===id?e.dataset.b:e.dataset.a;const og=svg.querySelector('.gnode[data-id=\\''+o+'\\']');if(og)og.classList.add('hot');}});
      const n=byId[id];if(n){tip.style.display='block';tip.innerHTML=(n.img?'<img src="'+esc(n.img)+'" style="width:100%;height:88px;object-fit:cover;border-radius:6px;margin-bottom:5px"/>':'')+'<b>'+esc(n.label)+'</b> <span class="muted">'+n.kind+'</span>'+(n.tStart!=null?'<div class="muted">'+ordYr(n.tStart)+(n.tEnd!=null&&n.tEnd!==n.tStart?'–'+ordYr(n.tEnd):'')+'</div>':'')+(relByNode[id]?'<div class="muted">'+esc(relByNode[id])+'</div>':'')+(n.sig?'<div style="color:'+sigCol[n.sig]+'">'+(n.sig==='positive'?'＋ ':n.sig==='negative'?'－ ':'± ')+n.sig+' signal</div>':'');}});
    g.addEventListener('mousemove',ev=>{tip.style.left=Math.min(ev.clientX+14,innerWidth-240)+'px';tip.style.top=(ev.clientY+14)+'px';});
    g.addEventListener('mouseleave',()=>{svg.classList.remove('dim');svg.querySelectorAll('.hot').forEach(x=>x.classList.remove('hot'));tip.style.display='none';});
    g.addEventListener('click',()=>{if(id===center){showNodeTab(center);}else{graphFor(id);}});});
  wrap.querySelectorAll('.gcluster').forEach(g=>g.addEventListener('click',()=>{gExpand[g.dataset.fam]=!gExpand[g.dataset.fam];drawGraph();}));
  wrap.querySelectorAll('.gchip').forEach(ch=>ch.addEventListener('click',()=>{gFilters[ch.dataset.fam]=!gFilters[ch.dataset.fam];drawGraph();}));
  const det=wrap.querySelector('[data-details]');if(det)det.addEventListener('click',()=>showNodeTab(center));
}
// ── Timeline: people lifespans (bars) + activities (markers) on a BC/AD axis ──
let tlFrom=-4200,tlTo=120;
const TL_ERAS=[['Full sweep',-4200,120],['Patriarchs',-2100,-1400],['Exodus & Conquest',-1600,-1150],['Judges & Monarchy',-1250,-560],['Exile & Return',-620,-380],['New Testament',-12,90]];
function tlZoom(f){const c=(tlFrom+tlTo)/2,half=Math.max(8,(tlTo-tlFrom)/2*f);tlFrom=Math.max(-4300,Math.round(c-half));tlTo=Math.min(160,Math.round(c+half));drawTimeline();}
function tlPan(frac){const span=tlTo-tlFrom,d=Math.round(span*frac);if(tlFrom+d<-4300||tlTo+d>160)return;tlFrom+=d;tlTo+=d;drawTimeline();}
const ordY=(y)=>y==null?'':('c. '+Math.abs(y)+(y<0?' BC':' AD'));
async function timeline(){
  V.innerHTML='<div class="card"><div class="sec-head">Timeline · people &amp; activities</div>'+
   '<div class="hint" style="margin:0 0 8px">Dates are scholarly estimates (Theographic) — the Bible states no calendar dates.</div>'+
   '<div class="gchips" id="teras"></div>'+
   '<div id="twrap"></div></div><div id="ttip" class="gtip"></div>';
  document.getElementById('teras').innerHTML=TL_ERAS.map((e,i)=>'<span class="gchip" data-i="'+i+'">'+esc(e[0])+'</span>').join('');
  document.querySelectorAll('#teras [data-i]').forEach(ch=>ch.onclick=()=>{const e=TL_ERAS[ch.dataset.i];tlFrom=e[1];tlTo=e[2];tlMark(ch);drawTimeline();});
  tlMark(document.querySelector('#teras [data-i]'));
  drawTimeline();
}
function tlMark(ch){document.querySelectorAll('#teras [data-i]').forEach(x=>{const on=x===ch;x.classList.toggle('on',on);x.style.cssText=on?'background:var(--accent);color:#fff;border-color:var(--accent)':'';});}
async function drawTimeline(){
  const wrap=document.getElementById('twrap');wrap.innerHTML='<div class="ghint">loading…</div>';
  const d=await api('/timeline?from='+tlFrom+'&to='+tlTo+(bookFilter?'&book='+bookFilter:''));
  const W=1060,mL=10,mR=12,axisY=30,laneH=20,barH=13,span=(d.to-d.from)||1;
  const X=(y)=>mL+(y-d.from)/span*(W-mL-mR);
  const col=(n)=>n.sig==='positive'?'#1a8a4f':n.sig==='negative'?'#c0392b':n.sig==='mixed'?'#b45309':(n.kind==='event'?'#0e7490':'#2563eb');
  // people: greedy lane packing reserving room for the trailing label
  const ppl=d.people.slice().sort((a,b)=>a.tStart-b.tStart),laneEnd=[];
  const place=(x0,x1)=>{for(let i=0;i<laneEnd.length;i++){if(laneEnd[i]<=x0-6){laneEnd[i]=x1;return i;}}laneEnd.push(x1);return laneEnd.length-1;};
  ppl.forEach(p=>{const x0=X(p.tStart),xe=X(p.tEnd!=null?p.tEnd:p.tStart),lw=Math.min(p.label.length,22)*6+12;p._x0=x0;p._xe=xe;p._lane=place(x0,Math.max(xe,x0+lw));});
  const pL=laneEnd.length||1,pTop=axisY+18,pBot=pTop+pL*laneH;
  // activities: diamonds, packed by x proximity
  const evs=d.events.slice().sort((a,b)=>a.tStart-b.tStart),evEnd=[];
  const ePlace=(x)=>{for(let i=0;i<evEnd.length;i++){if(evEnd[i]<=x-7){evEnd[i]=x+7;return i;}}evEnd.push(x+7);return evEnd.length-1;};
  evs.forEach(e=>{e._x=X(e.tStart);e._lane=ePlace(e._x);});
  const eL=evEnd.length||1,eTop=pBot+34,eBot=eTop+eL*15,H=eBot+20;
  const step=span>3000?500:span>1500?250:span>700?100:span>250?50:20;
  let ticks='';for(let y=Math.ceil(d.from/step)*step;y<=d.to;y+=step){const x=X(y);ticks+='<line x1="'+x+'" y1="'+axisY+'" x2="'+x+'" y2="'+H+'" stroke="#eef2f7"/><text x="'+x+'" y="'+(axisY-6)+'" text-anchor="middle" font-size="10" fill="#8a96a3">'+ordY(y)+'</text>';}
  let s='<svg id="tsvg" viewBox="0 0 '+W+' '+H+'">'+ticks+'<line x1="'+mL+'" y1="'+axisY+'" x2="'+(W-mR)+'" y2="'+axisY+'" stroke="#cbd5e1"/>'+
    '<text x="'+mL+'" y="'+(pTop-4)+'" font-size="10" font-weight="700" fill="#8a96a3">PEOPLE</text>';
  ppl.forEach(p=>{const y=pTop+p._lane*laneH,x0=p._x0,c=col(p),txt=p.label.length>22?p.label.slice(0,21)+'…':p.label,lbl=esc(txt),tw=txt.length*5.7;
    const full=p.tEnd!=null&&p.tEnd!==p.tStart;
    if(full){const xe=Math.max(p._xe,x0+3),lx=xe+4,flip=lx+tw>W-2;s+='<g class="tnode" data-id="'+esc(p.id)+'"><rect x="'+x0+'" y="'+y+'" width="'+(xe-x0)+'" height="'+barH+'" rx="3" fill="'+c+'" fill-opacity="0.85"/><text x="'+(flip?x0-4:lx)+'" y="'+(y+barH-3)+'" text-anchor="'+(flip?'end':'start')+'" font-size="10" fill="#33404f">'+lbl+'</text></g>';}
    else{const tc=p.basis==='relative'?'#94a3b8':'#d9822b',cy=y+barH/2,r=barH/1.3,lx=x0+r+4,flip=lx+tw>W-2;s+='<g class="tnode" data-id="'+esc(p.id)+'"><polygon points="'+x0+','+(cy-r)+' '+(x0+r)+','+(cy+r)+' '+(x0-r)+','+(cy+r)+'" fill="'+tc+'"/><text x="'+(flip?x0-r-4:lx)+'" y="'+(cy+r-1)+'" text-anchor="'+(flip?'end':'start')+'" font-size="10" fill="#33404f">'+lbl+'</text></g>';}});
  s+='<text x="'+mL+'" y="'+(eTop-6)+'" font-size="10" font-weight="700" fill="#8a96a3">ACTIVITIES</text>';
  evs.forEach(e=>{const y=eTop+e._lane*15+5,x=e._x,c=col(e),r=4;s+='<g class="tnode" data-id="'+esc(e.id)+'"><polygon points="'+x+','+(y-r)+' '+(x+r)+','+y+' '+x+','+(y+r)+' '+(x-r)+','+y+'" fill="'+c+'"/></g>';});
  s+='</svg>';
  const tr=d.eventTotal>d.events.length?' <span class="muted">(top '+d.events.length+' of '+d.eventTotal+' by attestation)</span>':'';
  wrap.innerHTML='<div class="ghint" style="margin:4px 0 6px">'+d.people.length+' people · '+d.events.length+' activities'+tr+' · '+ordY(d.from)+' – '+ordY(d.to)+'</div>'+s+
    '<div class="glegend">▬ lifespan (birth–death) &nbsp; <span style="color:#d9822b">▲</span> born, death unknown &nbsp; <span style="color:#94a3b8">▲</span> approx. (relative dating) &nbsp; ◆ activity &nbsp;·&nbsp; bar colour = signal <span style="color:#1a8a4f">＋</span>/<span style="color:#c0392b">－</span>/<span style="color:#b45309">~</span> &nbsp;·&nbsp; hover for detail, click to open</div>';
  const tip=document.getElementById('ttip'),byId={};[...d.people,...d.events].forEach(n=>byId[n.id]=n);
  wrap.querySelectorAll('.tnode').forEach(g=>{const n=byId[g.dataset.id];if(!n)return;
    g.addEventListener('mouseenter',()=>{tip.style.display='block';tip.innerHTML=(n.image_thumb?'<img src="'+esc(n.image_thumb)+'" style="width:100%;height:70px;object-fit:cover;border-radius:6px;margin-bottom:4px"/>':'')+'<b>'+esc(n.label)+'</b> <span class="muted">'+n.kind+'</span><div class="muted">'+ordY(n.tStart)+(n.tEnd!=null&&n.tEnd!==n.tStart?' – '+ordY(n.tEnd):'')+'</div>'+(n.disambig?'<div class="muted">'+esc(n.disambig)+'</div>':'');});
    g.addEventListener('mousemove',ev=>{tip.style.left=Math.min(ev.clientX+14,innerWidth-230)+'px';tip.style.top=(ev.clientY+14)+'px';});
    g.addEventListener('mouseleave',()=>tip.style.display='none');
    g.addEventListener('click',()=>showNodeTab(g.dataset.id));});
}
// ── Geospatial map (Leaflet) with time animation ──
let geoMap=null,geoTimer=null,geoShow=null;
async function geo(){
  V.innerHTML='<div class="card">'+
   '<div class="gchips" id="glayers" style="margin-bottom:5px"></div>'+
   '<div class="hint" style="margin:0 0 5px;font-size:11px"><span style="color:#c47d2e">▲</span> Regions off by default · <b>⛰ 3D</b> tilts into terrain · right-drag to rotate &amp; pitch</div>'+
   '<div id="map" style="height:560px;border:1px solid var(--line);border-radius:10px;z-index:0;position:relative;overflow:hidden"></div>'+
   '<div id="gtime" style="margin-top:12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap"></div></div>';
  const mapEl=document.getElementById('map');
  if(!window.maplibregl){mapEl.innerHTML='<div class="ghint" style="padding:24px">3D map library could not load (offline?). The same data is in Explore / Timeline.</div>';return;}
  const d=await api('/geo'+(bookFilter?'?book='+bookFilter:''));
  d.places.forEach(p=>{if(p.imgFull||p.img)geoImgFull[p.id]=p.imgFull||p.img;});
  const vrefs=(n)=>{const r=(n.refs||'').split('|').filter(Boolean);if(!r.length)return '';const more=(n.v||0)>r.length?' <span style="font:11px ui-monospace,monospace;color:#8a96a3">…+'+((n.v||0)-r.length)+'</span>':'';return '<div style="margin-top:5px">'+r.map(o=>{const bk=bookFilter&&String(o).indexOf(bookFilter+'.')===0;return '<a href="#" onclick="openPassage(\\''+esc(o)+'\\');return false" style="font:11px ui-monospace,monospace;background:'+(bk?'#fff3c4':'#eef2fb')+';color:'+(bk?'#7a5c00':'#3a4a63')+';border-radius:4px;padding:1px 6px;margin:1px;display:inline-block;text-decoration:none;'+(bk?'font-weight:700':'')+'">'+esc(o)+'</a>';}).join('')+more+'</div>';};
  const pimg=(n)=>n.img?'<img src="'+esc(n.img)+'" onclick="openImgFor(\\''+n.id+'\\')" onmouseenter="imgHover(this.src,event)" onmousemove="imgHoverMove(event)" onmouseleave="imgHoverOut()" title="hover to preview · click for full" style="width:100%;max-width:280px;border-radius:6px;margin-bottom:6px;cursor:zoom-in;display:block"/>':'';
  const pop=(n,ex)=>pimg(n)+'<b>'+esc(n.label)+'</b>'+(ex||'')+vrefs(n)+'<br><a href="#" onclick="showNodeTab(\\''+n.id+'\\');return false">open ↗</a>';
  const ESRI=(s)=>'https://server.arcgisonline.com/ArcGIS/rest/services/'+s+'/MapServer/tile/{z}/{y}/{x}';
  const style={version:8,sources:{
    topo:{type:'raster',tiles:[ESRI('World_Topo_Map')],tileSize:256,maxzoom:17,attribution:'Tiles &copy; Esri'},
    streets:{type:'raster',tiles:[ESRI('World_Street_Map')],tileSize:256,maxzoom:17,attribution:'Tiles &copy; Esri'},
    sat:{type:'raster',tiles:[ESRI('World_Imagery')],tileSize:256,maxzoom:17,attribution:'Tiles &copy; Esri'},
    dem:{type:'raster-dem',tiles:['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],tileSize:256,encoding:'terrarium',maxzoom:14,attribution:'Terrain: AWS Terrain Tiles'}
  },layers:[
    {id:'b-streets',type:'raster',source:'streets',layout:{visibility:'none'}},
    {id:'b-topo',type:'raster',source:'topo'},
    {id:'b-sat',type:'raster',source:'sat',layout:{visibility:'none'}},
    {id:'hill',type:'hillshade',source:'dem',layout:{visibility:'none'},paint:{'hillshade-exaggeration':0.45}}
  ]};
  const map=new maplibregl.Map({container:'map',style:style,center:[35.2,31.8],zoom:6,maxZoom:15,maxPitch:72,attributionControl:false});geoMap=map;
  map.on('error',()=>{});  // swallow intermittent tile-fetch resets so they can't crash the camera
  map.addControl(new maplibregl.NavigationControl({visualizePitch:true}),'bottom-right');
  map.addControl(new maplibregl.AttributionControl({compact:true}),'bottom-left');
  map.on('load',()=>{
    const fc=(a)=>({type:'FeatureCollection',features:a});
    const ft=(lon,lat,props)=>({type:'Feature',geometry:{type:'Point',coordinates:[lon,lat]},properties:props});
    const sigColor=['match',['get','sig'],'positive','#1a8a4f','negative','#c0392b','mixed','#b45309','#0e7490'];
    const sigColorP=['match',['get','sig'],'positive','#1a8a4f','negative','#c0392b','mixed','#b45309','#2563eb'];
    const pf=d.places.filter(p=>!p.region&&isFinite(p.lat)).map(p=>ft(p.lon,p.lat,{id:p.id,label:p.label,disambig:p.disambig||'',v:p.v||0,refs:p.refs||'',img:p.img||'',hasimg:p.img?1:0}));
    const rf=d.places.filter(p=>p.region&&isFinite(p.lat)).map(p=>ft(p.lon,p.lat,{id:p.id,label:p.label,disambig:p.disambig||'',v:p.v||0,refs:p.refs||''}));
    const ef=d.events.filter(e=>isFinite(e.lat)).map(e=>ft(e.lon,e.lat,{id:e.id+':'+(e.place||''),label:e.label+(e.place?' · '+e.place:''),place:e.place||'',v:e.v||0,refs:e.refs||'',year:e.tStart==null?99999:e.tStart,sig:e.sig||''}));
    const ppf=d.people.filter(pe=>isFinite(pe.lat)).map(pe=>ft(pe.lon,pe.lat,{id:pe.id,label:pe.label,place:pe.place||'',refs:pe.refs||'',t0:pe.tStart==null?99999:pe.tStart,t1:(pe.tEnd!=null?pe.tEnd:pe.tStart)==null?99999:(pe.tEnd!=null?pe.tEnd:pe.tStart),sig:pe.sig||''}));
    map.addSource('places',{type:'geojson',data:fc(pf)});
    map.addSource('regions',{type:'geojson',data:fc(rf)});
    map.addSource('events',{type:'geojson',data:fc(ef)});
    map.addSource('people',{type:'geojson',data:fc(ppf)});
    map.addLayer({id:'places',type:'circle',source:'places',paint:{'circle-radius':['min',9,['+',3,['sqrt',['max',1,['get','v']]]]],'circle-color':'#aab4c2','circle-stroke-color':'#7c8696','circle-stroke-width':1,'circle-opacity':0.92}});
    map.addLayer({id:'regions',type:'circle',source:'regions',layout:{visibility:'none'},paint:{'circle-radius':6,'circle-color':'#e8a44d','circle-stroke-color':'#c47d2e','circle-stroke-width':1.5,'circle-opacity':0.85}});
    map.addLayer({id:'events',type:'circle',source:'events',paint:{'circle-radius':['min',11,['+',4,['sqrt',['max',1,['get','v']]]]],'circle-color':sigColor,'circle-stroke-color':'#fff','circle-stroke-width':1,'circle-opacity':0.95}});
    map.addLayer({id:'people',type:'circle',source:'people',layout:{visibility:'none'},paint:{'circle-radius':6,'circle-color':sigColorP,'circle-stroke-color':'#fff','circle-stroke-width':1,'circle-opacity':0.95}});
    const popup=new maplibregl.Popup({maxWidth:'300px'});
    const hov=new maplibregl.Popup({closeButton:false,closeOnClick:false,offset:12,className:'mlhov',maxWidth:'190px'});
    const locById={};
    const show=(c,n,ex)=>{hov.remove();popup.setLngLat(c).setHTML(pop(n,ex)).addTo(map);};
    geoShow=(id)=>{const lc=locById[id];if(lc)lc.show();};
    let hovTimer=null,hovWired=false;
    const showHov=(coords,pr)=>{clearTimeout(hovTimer);
      const im=pr.img?'<img src="'+esc(pr.img)+'" onclick="geoShow(\\''+pr.id+'\\')" title="click for details" style="width:160px;height:90px;object-fit:cover;border-radius:5px;display:block;margin-bottom:4px;cursor:pointer"/>':'';
      hov.setLngLat(coords).setHTML(im+'<b>'+esc(pr.label)+'</b>'+(pr.img?'<div class="muted" style="font-size:10px;margin-top:1px">click image for details</div>':'')).addTo(map);
      if(!hovWired){const el=hov.getElement();if(el){hovWired=true;el.addEventListener('mouseenter',()=>clearTimeout(hovTimer));el.addEventListener('mouseleave',()=>hov.remove());}}};
    const hideHov=()=>{hovTimer=setTimeout(()=>hov.remove(),240);};
    const wire=(layer,exFn)=>{
      map.on('mouseenter',layer,()=>map.getCanvas().style.cursor='pointer');
      map.on('mouseleave',layer,()=>{map.getCanvas().style.cursor='';hideHov();});
      map.on('mousemove',layer,e=>showHov(e.features[0].geometry.coordinates,e.features[0].properties));
      map.on('click',layer,e=>{const f=e.features[0],pr=f.properties;show(f.geometry.coordinates,{id:pr.id,label:pr.label,refs:pr.refs,v:pr.v,img:pr.img||null},exFn(pr));});
    };
    wire('places',pr=>(pr.disambig?'<br><span style="color:#6b7785">'+esc(pr.disambig)+'</span>':'')+'<br>'+pr.v+' verses');
    wire('regions',pr=>'<br><span class="muted">▲ region · general area (approx.)</span>'+(pr.disambig?'<br><span style="color:#6b7785">'+esc(pr.disambig)+'</span>':'')+'<br>'+pr.v+' verses');
    wire('events',pr=>'<br><span style="color:#6b7785">at '+esc(pr.place||'')+'</span>');
    wire('people',pr=>'<br><span style="color:#6b7785">b. '+esc(pr.place||'')+'</span>');
    const regOf=(f,ex)=>locById[f.properties.id]={lon:f.geometry.coordinates[0],lat:f.geometry.coordinates[1],label:f.properties.label,show:()=>show(f.geometry.coordinates,{id:f.properties.id,label:f.properties.label,refs:f.properties.refs,v:f.properties.v,img:f.properties.img||null},ex(f.properties))};
    pf.forEach(f=>regOf(f,pr=>(pr.disambig?'<br><span style="color:#6b7785">'+esc(pr.disambig)+'</span>':'')+'<br>'+pr.v+' verses'));
    rf.forEach(f=>regOf(f,pr=>'<br><span class="muted">▲ region</span><br>'+pr.v+' verses'));
    ef.forEach(f=>regOf(f,pr=>'<br><span style="color:#6b7785">at '+esc(pr.place||'')+'</span>'));
    ppf.forEach(f=>regOf(f,pr=>'<br><span style="color:#6b7785">b. '+esc(pr.place||'')+'</span>'));
    const layers={Places:['places'],Activities:['events'],People:['people'],Regions:['regions']};
    const on={Places:true,Activities:true,People:false,Regions:false};
    const nReg=rf.length,cnt={Places:pf.length,Activities:ef.length,People:ppf.length,Regions:nReg};
    const lchip=(k)=>'<span class="gchip'+(on[k]?' on':'')+'" data-l="'+k+'"'+(on[k]?' style="background:var(--accent);color:#fff;border-color:var(--accent)"':'')+'>'+k+' ('+cnt[k]+')</span>';
    document.getElementById('glayers').innerHTML=Object.keys(layers).map(lchip).join('');
    const setVis=(k)=>{layers[k].forEach(l=>map.setLayoutProperty(l,'visibility',on[k]?'visible':'none'));};
    document.querySelectorAll('#glayers [data-l]').forEach(ch=>ch.onclick=()=>{const k=ch.dataset.l;on[k]=!on[k];setVis(k);ch.style.cssText=on[k]?'background:var(--accent);color:#fff;border-color:var(--accent)':'';ch.classList.toggle('on',on[k]);});
    const bctl=document.createElement('div');bctl.className='map-basectl';
    const BASES=[['Streets','b-streets'],['Topo','b-topo'],['Satellite','b-sat']];
    bctl.innerHTML=BASES.map((b,i)=>'<button class="map-basbtn'+(i===1?' on':'')+'" data-b="'+i+'">'+b[0]+'</button>').join('')+'<button class="map-basbtn" id="btn3d" title="tilt into 3D terrain" style="margin-left:3px;border-left:1px solid var(--line);padding-left:11px">⛰ 3D</button>';
    mapEl.appendChild(bctl);
    bctl.querySelectorAll('[data-b]').forEach((btn,i)=>btn.onclick=()=>{BASES.forEach((b,j)=>map.setLayoutProperty(b[1],'visibility',i===j?'visible':'none'));bctl.querySelectorAll('[data-b]').forEach((x,j)=>x.classList.toggle('on',i===j));});
    let is3D=false;document.getElementById('btn3d').onclick=function(){is3D=!is3D;if(is3D){map.setTerrain({source:'dem',exaggeration:1.3});map.setLayoutProperty('hill','visibility','visible');map.easeTo({pitch:55,duration:900});}else{map.setTerrain(null);map.setLayoutProperty('hill','visibility','none');map.easeTo({pitch:0,bearing:0,duration:900});}this.classList.toggle('on',is3D);};
    let hlMk=null;
    const allGeo=[...d.places,...d.events,...d.people];
    const sbox=document.createElement('div');sbox.className='map-search';sbox.innerHTML='<input id="mapq" placeholder="Find on map… (e.g. Jeruel, Bethel)"/><div id="mapres"></div>';mapEl.appendChild(sbox);
    const mapq=sbox.querySelector('#mapq'),mapres=sbox.querySelector('#mapres');
    const goTo=(id)=>{const lc=locById[id];if(!lc)return;if(hlMk)hlMk.remove();const el=document.createElement('div');el.innerHTML='<div class="mappulse"></div>';el.style.pointerEvents='none';hlMk=new maplibregl.Marker({element:el}).setLngLat([lc.lon,lc.lat]).addTo(map);map.flyTo({center:[lc.lon,lc.lat],zoom:11,duration:1200});setTimeout(()=>{try{lc.show();}catch(e){}},800);mapres.innerHTML='';mapq.value=lc.label;};
    const runMap=()=>{const t=mapq.value.trim().toLowerCase();if(t.length<2){mapres.innerHTML='';return;}const hits=allGeo.filter(n=>(n.label||'').toLowerCase().includes(t)&&locById[n.id]).slice(0,8);mapres.innerHTML=hits.length?'<ul class="list">'+hits.map(h=>'<li data-id="'+esc(h.id)+'">'+dot(h.kind||'place')+esc(h.label)+(h.place?' <span class="muted">'+esc(h.place)+'</span>':'')+'</li>').join('')+'</ul>':'<div class="ghint" style="padding:6px 10px">No mapped match for “'+esc(mapq.value)+'”.</div>';mapres.querySelectorAll('[data-id]').forEach(li=>li.onclick=()=>goTo(li.dataset.id));};
    let mt;mapq.oninput=()=>{clearTimeout(mt);mt=setTimeout(runMap,150);};
    mapq.onkeydown=(e)=>{if(e.key==='Enter'){const f=mapres.querySelector('[data-id]');if(f)goTo(f.dataset.id);}};
    const yrs=[...ef.map(f=>f.properties.year),...ppf.map(f=>f.properties.t0)].filter(y=>y!=null&&y<90000);
    if(yrs.length){
      const minY=Math.min(...yrs),maxY=Math.max(...yrs);let cur=maxY;
      document.getElementById('gtime').innerHTML='<button id="gplay" class="gchip">▶ play</button><input type="range" id="gyr" min="'+minY+'" max="'+maxY+'" value="'+maxY+'" style="flex:1;min-width:200px"><span id="gyl" class="mono" style="min-width:74px;font-weight:700"></span><label class="hint" style="display:flex;gap:5px;align-items:center;margin:0"><input type="checkbox" id="gcum" checked> cumulative</label>';
      const yr=document.getElementById('gyr'),yl=document.getElementById('gyl'),cum=document.getElementById('gcum');
      const applyYear=()=>{cur=+yr.value;yl.textContent=ordY(cur);const c=cum.checked;
        map.setFilter('events',c?['<=',['get','year'],cur]:['<=',['abs',['-',['get','year'],cur]],40]);
        map.setFilter('people',c?['<=',['get','t0'],cur]:['all',['<=',['get','t0'],cur],['>=',['get','t1'],cur]]);};
      yr.oninput=applyYear;cum.onchange=applyYear;
      document.getElementById('gplay').onclick=function(){if(geoTimer){clearInterval(geoTimer);geoTimer=null;this.textContent='▶ play';return;}this.textContent='⏸ pause';const step=Math.max(1,Math.round((maxY-minY)/120));if(cur>=maxY)cur=minY;geoTimer=setInterval(()=>{cur+=step;if(cur>=maxY){cur=maxY;yr.value=cur;applyYear();clearInterval(geoTimer);geoTimer=null;const b=document.getElementById('gplay');if(b)b.textContent='▶ play';return;}yr.value=cur;applyYear();},120);};
      applyYear();
    }
    setTimeout(()=>{try{map.resize();}catch(e){}},150);
  });
}
// ── Oikos circles: concentric relationship rings out from a person ──
let oikosCenter=null,oikosOrgs=false,oikosLabel='';
const RING=[{label:'Family (oikos)',color:'#e87c3e',r:120},{label:'Household & kin',color:'#0d9488',r:212},{label:'Network & conversations',color:'#9333ea',r:300}];
function ringOf(rel){if(/hasParent|hasChild|hasSibling|hasPartner|hasRelative/.test(rel))return 0;if(/memberOf|hasMember|holdsRole|bornAt|diedAt|hasResponsibility|hasSkill|hasMembership|gc:member|gc:organization|gc:membershipRole|companionOf/.test(rel))return 1;return 2;}
async function oikos(){
  V.innerHTML='<div class="card"><div id="ocrumb"></div><div class="sec-head">Oikos · relationship circles</div>'+
   '<div class="combo"><input id="oq" autocomplete="off" placeholder="Center on a person… (click to choose)"/><div id="ores" class="combo-menu"></div></div>'+
   '<div style="margin:10px 0 2px"><button id="oorg" class="map-basbtn'+(oikosOrgs?' on':'')+'" style="border:1px solid var(--line);border-radius:8px">⛪ Include organizations (churches, tribes…)</button></div>'+
   '<div id="owrap"></div></div><div id="otip" class="gtip"></div>';
  document.getElementById('oorg').onclick=function(){oikosOrgs=!oikosOrgs;this.classList.toggle('on',oikosOrgs);drawOikos();};
  const oq=document.getElementById('oq'),menu=document.getElementById('ores');let timer;
  const showMenu=async(term)=>{const d=await api('/search?q='+encodeURIComponent(term||'')+'&kind=person');const rs=(d.results||[]).filter(x=>x.kind==='person').slice(0,12);
    menu.innerHTML=rs.length?rs.map(x=>'<div class="combo-item" data-pick="'+x.id+'" data-lab="'+esc(x.label+(x.disambig?' · '+x.disambig:''))+'">'+dot('person')+'<b>'+esc(x.label)+'</b>'+(x.disambig?' <span class="muted">'+esc(x.disambig)+'</span>':'')+'</div>').join(''):'<div class="combo-empty">no people found</div>';
    menu.style.display='block';
    menu.querySelectorAll('[data-pick]').forEach(it=>it.onmousedown=(ev)=>{ev.preventDefault();oikosLabel=it.dataset.lab;oq.value=it.dataset.lab;menu.style.display='none';nav('oikos/'+it.dataset.pick);});};
  oq.oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>showMenu(oq.value.trim()),160);};
  oq.onfocus=()=>{oq.select();showMenu(oq.value.trim());};
  oq.onblur=()=>setTimeout(()=>{menu.style.display='none';},170);
  if(!oikosCenter){const d=await api('/search?q=Paul&kind=person');oikosCenter=(((d.results||[]).find(x=>x.label==='Paul'))||(d.results||[])[0]||{}).id;oikosLabel='Paul';}
  if(oikosLabel)oq.value=oikosLabel;
  else{const cn=await api('/node/'+oikosCenter);const nn=(cn&&cn.node)||cn||{};if(nn.label){oikosLabel=nn.label+(nn.disambig?' · '+nn.disambig:'');oq.value=oikosLabel;}}
  {const oc=document.getElementById('ocrumb');if(oc)oc.innerHTML=backCrumb(oikosCenter,oikosLabel);}
  drawOikos();
}
async function drawOikos(){
  const wrap=document.getElementById('owrap');wrap.innerHTML='<div class="ghint">loading…</div>';
  const d=await api('/graph?center='+encodeURIComponent(oikosCenter));if(!d.ok){wrap.innerHTML='<div class="ghint">could not load this node</div>';return;}
  const W=920,H=680,cx=460,cy=346,center=d.center,byId={};d.nodes.forEach(n=>byId[n.id]=n);
  const ring={},relOf={};
  d.edges.forEach(e=>{const nb=e.from===center?e.to:e.from;if(nb===center)return;const rg=ringOf(e.rel);if(ring[nb]==null||rg<ring[nb]){ring[nb]=rg;relOf[nb]=e.rel;}});
  const neighbors=d.nodes.filter(n=>n.id!==center&&ring[n.id]!=null&&(n.kind==='person'||(oikosOrgs&&n.kind==='organization')));
  const byRing=[[],[],[]];neighbors.forEach(n=>byRing[ring[n.id]].push(n));
  const pos={};byRing.forEach((mem,ri)=>{const rr=RING[ri];mem.forEach((nd,i)=>{pos[nd.id]=P(cx,cy,(i+0.5)/mem.length*360,rr.r);});});
  let s='<svg id="osvg" viewBox="0 0 '+W+' '+H+'" style="height:680px">';
  RING.forEach(rr=>{s+='<circle cx="'+cx+'" cy="'+cy+'" r="'+rr.r+'" fill="none" stroke="'+rr.color+'" stroke-opacity="0.25" stroke-dasharray="3 4"/>';});
  neighbors.forEach(n=>{const p=pos[n.id],rr=RING[ring[n.id]];s+='<line x1="'+cx+'" y1="'+cy+'" x2="'+p.x+'" y2="'+p.y+'" stroke="'+rr.color+'" stroke-opacity="0.3"/>';});
  neighbors.forEach(n=>{const p=pos[n.id];s+='<g class="gnode" data-id="'+esc(n.id)+'">'+shp(n.kind,p.x,p.y,10)+badge(p.x,p.y,10,n.sig)+'<text class="gnlabel" x="'+p.x+'" y="'+(p.y+22)+'" text-anchor="middle" font-size="9" fill="#33404f">'+esc(n.label.length>15?n.label.slice(0,14)+'…':n.label)+'</text></g>';});
  const cn=byId[center]||{label:'?',kind:'person'};
  const gfil='none';
  const cc=cn.img?'<defs><clipPath id="oclip"><circle cx="'+cx+'" cy="'+cy+'" r="34"/></clipPath></defs><image href="'+esc(cn.img)+'" x="'+(cx-34)+'" y="'+(cy-34)+'" width="68" height="68" clip-path="url(#oclip)" preserveAspectRatio="xMidYMid slice" style="filter:'+gfil+'"/><circle cx="'+cx+'" cy="'+cy+'" r="34" fill="none" stroke="#2f6df0" stroke-width="3"/>':'<circle cx="'+cx+'" cy="'+cy+'" r="34" fill="#2f6df0"/>';
  s+='<g class="gnode" data-id="'+esc(center)+'">'+cc+'<text x="'+cx+'" y="'+(cn.img?cy+52:cy+4)+'" text-anchor="middle" font-size="12" font-weight="700" fill="'+(cn.img?'#1f2733':'#fff')+'">'+esc(cn.label.length>16?cn.label.slice(0,15)+'…':cn.label)+'</text></g></svg>';
  const legend='<div class="glegend">'+RING.map((rr,i)=>'<span style="color:'+rr.color+'">● '+rr.label+' ('+byRing[i].length+')</span>').join(' &nbsp; ')+'</div>';
  wrap.innerHTML='<div class="gbread"><b>'+dot(cn.kind)+esc(cn.label)+'</b> <span class="muted">'+cn.kind+' · '+neighbors.length+' relationships in 3 circles</span> · <a class="link" data-det="1">details ↗</a></div>'+s+legend+'<div class="ghint">Click a node to recenter on them · click the center to open details.</div>';
  const tip=document.getElementById('otip');
  wrap.querySelectorAll('.gnode').forEach(g=>{const id=g.dataset.id,n=byId[id];if(!n)return;g.style.cursor='pointer';
    g.addEventListener('mouseenter',()=>{tip.style.display='block';tip.innerHTML='<b>'+esc(n.label)+'</b> <span class="muted">'+n.kind+'</span>'+(relOf[id]?'<div class="muted">'+esc(relOf[id])+'</div>':'');});
    g.addEventListener('mousemove',ev=>{tip.style.left=Math.min(ev.clientX+14,innerWidth-220)+'px';tip.style.top=(ev.clientY+14)+'px';});
    g.addEventListener('mouseleave',()=>tip.style.display='none');
    g.addEventListener('click',()=>{if(id===center)showNodeTab(center);else oikosFor(id);});});
  const det=wrap.querySelector('[data-det]');if(det)det.onclick=()=>showNodeTab(center);
}
// ── Generational map: descent tree (parent→child by generation) + org derivation ──
let genRoot=null,genRels='gc:hasChild';
const GEN_LENS=[['gc:hasChild','Descent (parent→child)'],['gc:discipled,gc:planted','Discipleship & church plants'],['gc:gaveRiseTo,gc:hasSubOrganization,gc:grewOutOf,gc:planted,gc:discipled','Organizations (what grew out of what)']];
async function generations(){
  V.innerHTML='<div class="card"><div class="sec-head">Generations · lineage · discipleship · movements</div>'+
   '<div class="gchips" id="glens"></div>'+
   '<input id="gnq" placeholder="Root… (descent: Abraham, Jacob · movement: Jesus, Paul, Barnabas)"/><div id="gnres"></div><div id="gnwrap"></div></div>'+
   '<div id="orgwrap"></div><div id="otip" class="gtip"></div>';
  const drawLens=()=>{document.getElementById('glens').innerHTML=GEN_LENS.map(l=>'<span class="gchip'+(genRels===l[0]?' on':'')+'" data-l="'+l[0]+'"'+(genRels===l[0]?' style="background:var(--accent);color:#fff;border-color:var(--accent)"':'')+'>'+esc(l[1])+'</span>').join('');document.querySelectorAll('#glens [data-l]').forEach(ch=>ch.onclick=async()=>{genRels=ch.dataset.l;const q=genRels==='gc:hasChild'?null:(genRels.indexOf('hasSubOrganization')>=0?'Israel':'Jesus');if(q){const d=await api('/search?q='+q);genRoot=(((d.results||[]).find(x=>x.label===q))||(d.results||[])[0]||{}).id;}drawLens();drawGen();});};
  drawLens();
  const q=document.getElementById('gnq');let t;
  q.oninput=()=>{clearTimeout(t);t=setTimeout(async()=>{const r=document.getElementById('gnres');if(q.value.trim().length<2){r.innerHTML='';return;}
    const d=await api('/search?q='+encodeURIComponent(q.value.trim()));
    r.innerHTML='<ul class="list">'+d.results.filter(x=>x.kind==='person').slice(0,8).map(x=>'<li data-pick="'+x.id+'">'+dot(x.kind)+esc(x.label)+' <span class="muted">'+esc(x.disambig||'')+'</span></li>').join('')+'</ul>';
    r.querySelectorAll('[data-pick]').forEach(li=>li.onclick=()=>nav('generations/'+li.dataset.pick));
  },180);};
  if(!genRoot){const d=await api('/search?q=Abraham');genRoot=(((d.results||[]).find(x=>x.label==='Abraham'))||(d.results||[])[0]||{}).id;}
  drawGen();drawOrgs();
}
async function drawGen(){
  const wrap=document.getElementById('gnwrap');wrap.innerHTML='<div class="ghint">loading…</div>';
  const d=await api('/lineage?root='+encodeURIComponent(genRoot)+'&depth=5&rels='+encodeURIComponent(genRels));if(!d.ok){wrap.innerHTML='<div class="ghint">could not load this lineage</div>';return;}
  const W=1040,rowH=94,padT=24,padX=24,pos={},parentOf={};
  d.edges.forEach(e=>{if(parentOf[e.to]==null)parentOf[e.to]=e.from;});
  d.levels.forEach((lvl,depth)=>{
    if(depth>0)lvl.sort((a,b)=>((pos[parentOf[a.id]]||{}).x||0)-((pos[parentOf[b.id]]||{}).x||0));
    const n=lvl.length;lvl.forEach((nd,i)=>{pos[nd.id]={x:padX+(i+0.5)/n*(W-2*padX),y:padT+depth*rowH+18};});
  });
  const H=padT+d.levels.length*rowH+24,ord=(y)=>y==null?'':(Math.abs(y)+(y<0?'BC':'AD'));
  let s='<svg id="gnsvg" viewBox="0 0 '+W+' '+H+'" style="height:'+H+'px">';
  d.levels.forEach((lvl,depth)=>{s+='<text x="2" y="'+(padT+depth*rowH+14)+'" font-size="10" font-weight="700" fill="#8a96a3">GEN '+depth+'</text>';});
  d.edges.forEach(e=>{const a=pos[e.from],b=pos[e.to];if(!a||!b)return;const my=(a.y+b.y)/2;s+='<path d="M'+a.x+' '+(a.y+12)+' C'+a.x+' '+my+' '+b.x+' '+my+' '+b.x+' '+(b.y-12)+'" fill="none" stroke="#cbd5e1" stroke-width="1.1"/>';});
  const all=[];d.levels.forEach(l=>l.forEach(n=>all.push(n)));
  for(const n of all){const p=pos[n.id],c=KC[n.kind]||'#2563eb';
    const node=n.image_thumb?'<clipPath id="cl_'+esc(n.id)+'"><circle cx="'+p.x+'" cy="'+p.y+'" r="13"/></clipPath><image href="'+esc(n.image_thumb)+'" x="'+(p.x-13)+'" y="'+(p.y-13)+'" width="26" height="26" clip-path="url(#cl_'+esc(n.id)+')" preserveAspectRatio="xMidYMid slice"/><circle cx="'+p.x+'" cy="'+p.y+'" r="13" fill="none" stroke="'+c+'" stroke-width="2"/>':'<circle cx="'+p.x+'" cy="'+p.y+'" r="11" fill="'+c+'"/>';
    s+='<g class="gnode" data-id="'+esc(n.id)+'">'+node+'<text class="gnlabel" x="'+p.x+'" y="'+(p.y+25)+'" text-anchor="middle" font-size="9" fill="#33404f">'+esc(n.label.length>16?n.label.slice(0,15)+'…':n.label)+'</text></g>';}
  s+='</svg>';
  wrap.innerHTML='<div class="gbread"><b>'+esc(all[0].label)+'</b> <span class="muted">'+d.total+' descendants · '+d.levels.length+' generations</span></div>'+s+'<div class="ghint">Generations run top→bottom (GEN 0 = the root). Click a person to open.</div>';
  const tip=document.getElementById('otip'),byId={};all.forEach(n=>byId[n.id]=n);
  wrap.querySelectorAll('.gnode').forEach(g=>{const id=g.dataset.id,n=byId[id];if(!n)return;g.style.cursor='pointer';
    g.addEventListener('mouseenter',()=>{tip.style.display='block';tip.innerHTML='<b>'+esc(n.label)+'</b>'+(n.tStart!=null?'<div class="muted">'+ord(n.tStart)+(n.tEnd!=null&&n.tEnd!==n.tStart?'–'+ord(n.tEnd):'')+'</div>':'');});
    g.addEventListener('mousemove',ev=>{tip.style.left=Math.min(ev.clientX+14,innerWidth-200)+'px';tip.style.top=(ev.clientY+14)+'px';});
    g.addEventListener('mouseleave',()=>tip.style.display='none');
    g.addEventListener('click',()=>showNodeTab(id));});
}
async function drawOrgs(){
  const w=document.getElementById('orgwrap');const d=await api('/orgs');
  const rows=(d.orgs||[]).map(o=>'<tr><td onclick="showNodeTab(\\''+o.id+'\\')" style="cursor:pointer">'+dot('organization')+'<b>'+esc(o.label)+'</b> <span class="muted">'+esc((o.gc_class||'').replace('gc:',''))+'</span></td><td>'+(o.founder?'<a class="link" onclick="showNodeTab(\\''+o.founderId+'\\')">'+esc(o.founder)+'</a>':'<span class="muted">—</span>')+'</td><td>'+(o.parentOrg?esc(o.parentOrg):'<span class="muted">—</span>')+'</td><td>'+(o.members||0)+'</td></tr>').join('');
  w.innerHTML='<div class="card"><h3 class="muted" style="margin-top:0">Organizations — what grew out of what</h3>'+
   '<p class="hint" style="margin-top:0">Tribes, nations, houses and assemblies, and the founders / parent organizations they descend from.</p>'+
   '<table><tr><th>organization</th><th>grew out of</th><th>part of</th><th>members</th></tr>'+rows+'</table></div>';
}
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
// Initial paint — but NOT while a connect/Buy-access redirect is being processed (?code present); in that
// case connectCallback() does the single render after it claims the pass, so gated reads don't flash 402.
if(typeof location==='undefined'||!new URLSearchParams(location.search).get('code'))applyHash();
</script></body></html>`;
