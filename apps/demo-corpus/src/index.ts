// demo-corpus — corpus owner/admin Worker + inline SPA.
// P1: the entitlement Requests queue (approve/deny). Owner signs in via OIDC (client_id=demo-corpus);
// every admin write requires a server-side-verified id_token, gated to OWNER_SUB when configured.
// Calls the BSB corpus manager (demo-bible-mcp) via a service binding. (Claim ceremony / KMS = P0.)

import { Hono } from 'hono';

type Env = {
  MCP?: { fetch: (url: string, init?: RequestInit) => Promise<Response> };
  CLIENT_ID?: string;
  OWNER_SUB?: string;
};

const app = new Hono<{ Bindings: Env }>();

const MCP_URL = 'https://demo-bible-mcp-production.richardpedersen3.workers.dev';
function mcp(env: Env, path: string, body: unknown): Promise<Record<string, unknown>> {
  const init = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
  return (env.MCP ? env.MCP.fetch(`https://mcp${path}`, init) : fetch(`${MCP_URL}${path}`, init)).then((r) => r.json() as Promise<Record<string, unknown>>);
}

// ── server-side id_token verification (ES256 vs the home JWKS, iss-allowlisted, aud, exp) ──
const CONNECT_DOMAIN = 'impact-agent.me';
function isAllowedIssuer(origin: string): boolean {
  try { const u = new URL(origin); if (u.protocol !== 'https:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') return false; if (u.pathname !== '/' && u.pathname !== '') return false; const h = u.hostname; return h === CONNECT_DOMAIN || h.endsWith(`.${CONNECT_DOMAIN}`) || h === 'localhost' || h === '127.0.0.1'; } catch { return false; }
}
function b64urlBytes(seg: string): Uint8Array { const bin = atob(seg.replace(/-/g, '+').replace(/_/g, '/')); const o = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i); return o; }
function decodeSeg<T>(seg: string): T { return JSON.parse(new TextDecoder().decode(b64urlBytes(seg))) as T; }
async function verifyIdToken(env: Env, idToken: string): Promise<{ sub: string; name: string }> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('id_token malformed');
  const header = decodeSeg<{ alg?: string; kid?: string }>(parts[0]!);
  const claims = decodeSeg<{ iss?: string; aud?: string; exp?: number; sub?: string; canonical_agent_id?: string; agent_name?: string }>(parts[1]!);
  const iss = String(claims.iss ?? '');
  if (!isAllowedIssuer(iss)) throw new Error('issuer not allowed');
  const base = iss.endsWith('/') ? iss.slice(0, -1) : iss;
  const jwks = (await (await fetch(`${base}/jwks`)).json()) as { keys: Array<JsonWebKey & { kid: string; alg: string }> };
  const jwk = (jwks.keys ?? []).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('no JWKS key for kid');
  if (jwk.alg !== 'ES256' || header.alg !== 'ES256') throw new Error('alg not ES256');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64urlBytes(parts[2]!) as BufferSource, new TextEncoder().encode(`${parts[0]}.${parts[1]}`) as BufferSource);
  if (!ok) throw new Error('id_token signature invalid');
  if (String(claims.aud) !== (env.CLIENT_ID ?? 'demo-corpus')) throw new Error('aud not allowed');
  if (typeof claims.exp !== 'number' || claims.exp * 1000 < Date.now()) throw new Error('id_token expired');
  const sub = claims.canonical_agent_id ?? claims.sub;
  if (!sub) throw new Error('no subject in id_token');
  return { sub, name: claims.agent_name ?? '' };
}
/** Verify + (if OWNER_SUB configured) require the connected sub IS the claimed corpus owner. */
async function ownerGate(env: Env, idToken: string): Promise<{ sub: string; name: string }> {
  const c = await verifyIdToken(env, idToken);
  if (env.OWNER_SUB && env.OWNER_SUB.length > 0 && c.sub.toLowerCase() !== env.OWNER_SUB.toLowerCase()) throw new Error('not the corpus owner');
  return c;
}

// ── admin API (owner-gated) ──
app.post('/admin/requests', async (c) => {
  const b = await c.req.json<{ id_token?: string }>().catch(() => ({}) as { id_token?: string });
  try { await ownerGate(c.env, String(b.id_token ?? '')); const r = await mcp(c.env, '/tools/list_requests', { status: 'pending' }); return c.json(r); }
  catch (e) { return c.json({ ok: false, error: (e as Error).message }, 401); }
});
app.post('/admin/approve', async (c) => {
  const b = await c.req.json<{ id_token?: string; requestId?: number; ttlSeconds?: number }>().catch(() => ({}) as Record<string, never>);
  try {
    const owner = await ownerGate(c.env, String(b.id_token ?? ''));
    const lr = await mcp(c.env, '/tools/list_requests', { status: 'pending' });
    const req = ((lr.requests as Array<{ id: number; subject: string; edition: string }>) ?? []).find((r) => r.id === b.requestId);
    if (!req) return c.json({ ok: false, error: 'request not pending' }, 404);
    const res = await mcp(c.env, '/tools/issue_entitlement', { edition: req.edition, subject: req.subject, requestId: req.id, issuedBySub: owner.sub, ttlSeconds: b.ttlSeconds ?? 86400 });
    return c.json(res);
  } catch (e) { return c.json({ ok: false, error: (e as Error).message }, 401); }
});
app.post('/admin/deny', async (c) => {
  const b = await c.req.json<{ id_token?: string; requestId?: number; reason?: string }>().catch(() => ({}) as Record<string, never>);
  try { const owner = await ownerGate(c.env, String(b.id_token ?? '')); const r = await mcp(c.env, '/tools/deny_request', { id: b.requestId, reason: b.reason, deniedBySub: owner.sub }); return c.json(r); }
  catch (e) { return c.json({ ok: false, error: (e as Error).message }, 401); }
});
app.get('/health', (c) => c.json({ ok: true, service: 'demo-corpus' }));
app.get('/', (c) => c.html(SPA));

export default app;

const SPA = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Corpus Manager — Entitlements</title>
<style>
:root{--accent:#2f6df0;--line:#e3e8ef;--muted:#6b7785}
*{box-sizing:border-box}body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:#f6f8fb;color:#1a2433}
.hdr{display:flex;align-items:center;gap:12px;padding:14px 20px;background:#fff;border-bottom:1px solid var(--line)}
.hdr h1{font-size:16px;margin:0;font-weight:700}.hdr .sub{color:var(--muted);font-size:12px}
#who{margin-left:auto;display:flex;gap:8px;align-items:center}
button{font:inherit;cursor:pointer;border:1px solid var(--line);background:#fff;border-radius:8px;padding:6px 11px}
.conn{background:var(--accent);color:#fff;border:0;font-weight:600}
main{max-width:760px;margin:22px auto;padding:0 16px}
.card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin-bottom:16px}
.muted{color:var(--muted)}
.req{display:flex;align-items:center;gap:12px;padding:11px 0;border-bottom:1px solid var(--line);flex-wrap:wrap}
.req .acts{margin-left:auto;display:flex;gap:7px;align-items:center}
.req select{padding:5px;border:1px solid var(--line);border-radius:7px}
.ap{background:#1a8a4f;color:#fff;border:0;font-weight:600}.dn{background:#fff;color:#c0392b;border:1px solid #f0c5bd}
</style></head><body>
<div class="hdr"><h1>🗂️ Corpus Manager</h1><span class="sub">BSB · entitlement approvals</span><span id="who"></span></div>
<main>
<div class="card"><h3 style="margin-top:0">Requests queue</h3>
<p class="muted" style="font-size:13px">Readers request access to licensed editions from inside the Bible Explorer. Approve to issue a signed, time-boxed entitlement to that reader; deny to decline. Only the corpus owner may act.</p>
<div id="queue"></div></div>
</main>
<script>
const esc=(s)=>String(s==null?'':s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const CONNECT_DOMAIN='impact-agent.me',CLIENT_ID='demo-corpus',CENTRAL_AUTH_ORIGIN='https://www.'+CONNECT_DOMAIN,CONNECT_DELEGATE='0x89D13c596c45E4eE80Af5ae06C727FE9A820ffD0';
let session=null;
function loadSession(){try{const j=JSON.parse(localStorage.getItem('corp.session')||'null');session=(j&&j.exp*1000>Date.now())?j:null;if(!session)localStorage.removeItem('corp.session');}catch(e){session=null;}}
function isConnected(){return !!session;}
function b64url(b){let s='';for(let i=0;i<b.length;i++)s+=String.fromCharCode(b[i]);return btoa(s).split('+').join('-').split('/').join('_').replace(/=+$/,'');}
function fromB64url(seg){const bin=atob(seg.split('-').join('+').split('_').join('/'));const o=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)o[i]=bin.charCodeAt(i);return o;}
function decodeSeg(seg){return JSON.parse(new TextDecoder().decode(fromB64url(seg)));}
const randB64=(n)=>b64url(crypto.getRandomValues(new Uint8Array(n)));
async function pkce(){const v=randB64(32);const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v));return {verifier:v,challenge:b64url(new Uint8Array(d))};}
function isAllowedIssuer(origin){try{const u=new URL(origin);if(u.protocol!=='https:'&&u.hostname!=='localhost'&&u.hostname!=='127.0.0.1')return false;if(u.pathname!=='/'&&u.pathname!=='')return false;const h=u.hostname;return h===CONNECT_DOMAIN||h.endsWith('.'+CONNECT_DOMAIN)||h==='localhost'||h==='127.0.0.1';}catch(e){return false;}}
async function connectStart(){const state=randB64(16),nonce=randB64(16),pk=await pkce();
  sessionStorage.setItem('corp.pending',JSON.stringify({state,nonce,verifier:pk.verifier}));
  const u=new URL('/',CENTRAL_AUTH_ORIGIN);u.searchParams.set('client_id',CLIENT_ID);u.searchParams.set('redirect_uri',location.origin+'/');u.searchParams.set('response_type','code');u.searchParams.set('scope','openid agent');u.searchParams.set('state',state);u.searchParams.set('nonce',nonce);u.searchParams.set('code_challenge',pk.challenge);u.searchParams.set('code_challenge_method','S256');u.searchParams.set('agent_name','');u.searchParams.set('delegate',CONNECT_DELEGATE);u.searchParams.set('delegation_template','site-login');location.href=u.toString();}
async function verifyIdToken(idToken,expectedNonce){if(!isAllowedIssuer(CENTRAL_AUTH_ORIGIN))throw new Error('issuer');
  const parts=idToken.split('.');if(parts.length!==3)throw new Error('malformed');
  const header=decodeSeg(parts[0]),claims=decodeSeg(parts[1]);
  const jwks=await fetch(CENTRAL_AUTH_ORIGIN+'/jwks').then(r=>r.json());const jwk=(jwks.keys||[]).find(k=>k.kid===header.kid);if(!jwk)throw new Error('no key');
  if(jwk.alg!=='ES256'||header.alg!=='ES256')throw new Error('alg');
  const key=await crypto.subtle.importKey('jwk',jwk,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
  const ok=await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,fromB64url(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1]));
  if(!ok)throw new Error('signature');if(claims.iss!==CENTRAL_AUTH_ORIGIN)throw new Error('iss');if(claims.aud!==CLIENT_ID)throw new Error('aud');if(expectedNonce&&claims.nonce!==expectedNonce)throw new Error('nonce');if(typeof claims.exp!=='number'||claims.exp*1000<Date.now())throw new Error('expired');return claims;}
async function connectCallback(){const p=new URLSearchParams(location.search);const code=p.get('code'),state=p.get('state');if(!code||!state)return false;
  let pend=null;try{pend=JSON.parse(sessionStorage.getItem('corp.pending')||'null');}catch(e){}
  history.replaceState(null,'',location.pathname);
  if(!pend||pend.state!==state)return false;
  try{const tr=await fetch(CENTRAL_AUTH_ORIGIN+'/token',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({grant_type:'authorization_code',code,code_verifier:pend.verifier,client_id:CLIENT_ID,redirect_uri:location.origin+'/'})}).then(r=>r.json());
    if(!tr.id_token)throw new Error(tr.error||'no id_token');
    const claims=await verifyIdToken(tr.id_token,pend.nonce);
    session={idToken:tr.id_token,name:claims.agent_name||'',sub:claims.canonical_agent_id||claims.sub||'',exp:claims.exp};
    localStorage.setItem('corp.session',JSON.stringify(session));sessionStorage.removeItem('corp.pending');return true;
  }catch(e){alert('Connect failed: '+(e&&e.message?e.message:e));return false;}}
function disconnect(){session=null;localStorage.removeItem('corp.session');render();}
const post=(p,b)=>fetch(p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}).then(r=>r.json());
async function loadQueue(){const el=document.getElementById('queue');if(!el)return;
  if(!isConnected()){el.innerHTML='<p class="muted">Connect as the corpus owner to review requests.</p>';return;}
  el.innerHTML='<p class="muted">loading…</p>';
  const r=await post('/admin/requests',{id_token:session.idToken}).catch(e=>({ok:false,error:String(e)}));
  if(!r||!r.ok){el.innerHTML='<p style="color:#c0392b">'+esc((r&&r.error)||'failed')+'</p>';return;}
  const reqs=r.requests||[];
  el.innerHTML=reqs.length?reqs.map(q=>'<div class="req"><div><b>'+esc(q.edition)+'</b> <span class="muted">'+esc(q.subject_name||q.subject)+'</span><div class="muted" style="font-size:11px">'+esc(q.note||'')+' · '+esc((q.created_at||'').slice(0,16).replace('T',' '))+'</div></div><div class="acts"><select id="ttl'+q.id+'"><option value="3600">1 hour</option><option value="86400" selected>1 day</option><option value="2592000">30 days</option></select><button class="ap" onclick="approve('+q.id+')">Approve</button><button class="dn" onclick="deny('+q.id+')">Deny</button></div></div>').join(''):'<p class="muted">No pending requests.</p>';}
async function approve(id){const sel=document.getElementById('ttl'+id);const ttl=parseInt(sel?sel.value:'86400',10)||86400;const r=await post('/admin/approve',{id_token:session.idToken,requestId:id,ttlSeconds:ttl}).catch(e=>({ok:false,error:String(e)}));if(r&&r.ok)loadQueue();else alert('Approve failed: '+((r&&r.error)||'?'));}
async function deny(id){const reason=prompt('Deny reason (optional):','')||'';const r=await post('/admin/deny',{id_token:session.idToken,requestId:id,reason:reason}).catch(e=>({ok:false,error:String(e)}));if(r&&r.ok)loadQueue();else alert('Deny failed: '+((r&&r.error)||'?'));}
function render(){const w=document.getElementById('who');if(w)w.innerHTML=isConnected()?'<span class="muted">● '+esc(session.name||(session.sub||'').slice(0,14))+'</span> <button onclick="disconnect()">Disconnect</button>':'<button class="conn" onclick="connectStart()">🌐 Connect with Global.Church</button>';loadQueue();}
loadSession();connectCallback().then(()=>render());
</script></body></html>`;
