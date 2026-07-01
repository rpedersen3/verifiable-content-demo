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
const CONNECT_DOMAIN = 'churchcore.me';
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
/** Verify the id_token + require the caller IS the claimed corpus owner (first-claim-wins). */
// Corpora this manager administers — each a licensed edition owned by its service agent (custodied by
// a possibly-distinct user). Pick one, connect as that agent, then claim/manage it.
const CORPORA = {
  bsb: { service: 'bsb-archive', agent: 'fbsb.impact', edition: 'demo-licensed' },
  lbsb: { service: 'lbsb', agent: 'lbsb.impact', edition: 'lbsb' },
  // Not a corpus — the independent validator's signing identity. Listed so its OWN custodian can authorize
  // its KMS key (per-custodian, spec 266). No edition: the requests/treasury panels are simply empty for it.
  validator: { service: 'validator', agent: 'demo-validator.impact', edition: '' },
  // Not a corpus — the responding resolver agent's citation-signing identity. Same per-custodian ceremony:
  // its custodian authorizes scripture-resolver.impact's KMS key so citations sign with no held key.
  resolver: { service: 'resolver', agent: 'scripture-resolver.impact', edition: '' },
} as const;
const corpusOf = (k?: string) => (k && k in CORPORA ? CORPORA[k as keyof typeof CORPORA] : CORPORA.bsb);

async function ownerGate(env: Env, idToken: string, corpusKey?: string): Promise<{ sub: string; name: string }> {
  const c = await verifyIdToken(env, idToken);
  const cp = corpusOf(corpusKey);
  const r = await mcp(env, '/tools/get_service_identity', { service: cp.service });
  const id = r.identity as { owner_sub?: string } | null;
  if (!id?.owner_sub) throw new Error('corpus unclaimed — connect to claim it');
  if (id.owner_sub.toLowerCase() !== c.sub.toLowerCase()) throw new Error('not the corpus owner');
  return c;
}

// Claim ceremony: the ANS-authorized custodian of the corpus's service agent becomes its owner.
app.post('/admin/claim', async (c) => {
  const b = await c.req.json<{ id_token?: string; corpus?: string }>().catch(() => ({}) as Record<string, never>);
  try {
    const cp = corpusOf(b.corpus);
    const user = await verifyIdToken(c.env, String(b.id_token ?? ''));
    const r = await mcp(c.env, '/tools/claim_service', { service: cp.service, agentName: cp.agent, ownerSub: user.sub });
    return c.json({ ...r, you: user.sub, name: user.name, corpus: b.corpus ?? 'bsb', agent: cp.agent });
  } catch (e) { return c.json({ ok: false, error: (e as Error).message }, 401); }
});

// ── admin API (owner-gated, scoped to the selected corpus) ──
app.post('/admin/requests', async (c) => {
  const b = await c.req.json<{ id_token?: string; corpus?: string }>().catch(() => ({}) as Record<string, never>);
  try { await ownerGate(c.env, String(b.id_token ?? ''), b.corpus); const r = await mcp(c.env, '/tools/list_requests', { status: 'pending', edition: corpusOf(b.corpus).edition }); return c.json(r); }
  catch (e) { return c.json({ ok: false, error: (e as Error).message }, 401); }
});
app.post('/admin/approve', async (c) => {
  const b = await c.req.json<{ id_token?: string; corpus?: string; requestId?: number; ttlSeconds?: number }>().catch(() => ({}) as Record<string, never>);
  try {
    const cp = corpusOf(b.corpus);
    const owner = await ownerGate(c.env, String(b.id_token ?? ''), b.corpus);
    const lr = await mcp(c.env, '/tools/list_requests', { status: 'pending', edition: cp.edition });
    const req = ((lr.requests as Array<{ id: number; subject: string; edition: string }>) ?? []).find((r) => r.id === b.requestId);
    if (!req) return c.json({ ok: false, error: 'request not pending' }, 404);
    const res = await mcp(c.env, '/tools/issue_entitlement', { edition: req.edition, subject: req.subject, requestId: req.id, issuedBySub: owner.sub, ttlSeconds: b.ttlSeconds ?? 86400 });
    return c.json(res);
  } catch (e) { return c.json({ ok: false, error: (e as Error).message }, 401); }
});
app.post('/admin/deny', async (c) => {
  const b = await c.req.json<{ id_token?: string; corpus?: string; requestId?: number; reason?: string }>().catch(() => ({}) as Record<string, never>);
  try { const owner = await ownerGate(c.env, String(b.id_token ?? ''), b.corpus); const r = await mcp(c.env, '/tools/deny_request', { id: b.requestId, reason: b.reason, deniedBySub: owner.sub }); return c.json(r); }
  catch (e) { return c.json({ ok: false, error: (e as Error).message }, 401); }
});
app.post('/admin/issued', async (c) => {
  const b = await c.req.json<{ id_token?: string; corpus?: string }>().catch(() => ({}) as Record<string, never>);
  try { await ownerGate(c.env, String(b.id_token ?? ''), b.corpus); const r = await mcp(c.env, '/tools/list_issued', { status: 'granted', edition: corpusOf(b.corpus).edition }); return c.json(r); }
  catch (e) { return c.json({ ok: false, error: (e as Error).message }, 401); }
});
app.post('/admin/revoke', async (c) => {
  const b = await c.req.json<{ id_token?: string; corpus?: string; id?: number }>().catch(() => ({}) as Record<string, never>);
  try { await ownerGate(c.env, String(b.id_token ?? ''), b.corpus); const r = await mcp(c.env, '/tools/revoke_entitlement', { id: b.id }); return c.json(r); }
  catch (e) { return c.json({ ok: false, error: (e as Error).message }, 401); }
});
// x402 treasury: the settlements ledger for this corpus's edition (reader → lbsb treasury charges).
app.post('/admin/treasury', async (c) => {
  const b = await c.req.json<{ id_token?: string; corpus?: string }>().catch(() => ({}) as Record<string, never>);
  try { await ownerGate(c.env, String(b.id_token ?? ''), b.corpus); const r = await mcp(c.env, '/tools/list_settlements', { edition: corpusOf(b.corpus).edition }); return c.json(r); }
  catch (e) { return c.json({ ok: false, error: (e as Error).message }, 401); }
});
// All trust-signal feedback across the corpus (owner moderation view), with filters. Proxies to the
// ontology's /api/feedback via the MCP graph_query tool (reuses the MCP service binding).
app.post('/admin/feedback', async (c) => {
  const b = await c.req.json<{ id_token?: string; stance?: string; author?: string; subject?: string }>().catch(() => ({}) as Record<string, never>);
  try {
    await ownerGate(c.env, String(b.id_token ?? ''));
    const qs = new URLSearchParams({ all: '1' });
    if (b.stance) qs.set('stance', String(b.stance));
    if (b.author) qs.set('author', String(b.author));
    if (b.subject) qs.set('subject', String(b.subject));
    const r = await mcp(c.env, '/tools/graph_query', { path: '/api/feedback?' + qs.toString() });
    return c.json((r.body as Record<string, unknown>) ?? r);
  } catch (e) { return c.json({ ok: false, error: (e as Error).message }, 401); }
});
// Signing-identity roster (non-secret platform status): every identity that must authorize a Cloud-KMS
// signing key, merged with which have ALREADY stored their owner-signed SA→key delegation. Ungated —
// it's public status (no leaf bodies, no secrets), so the tab can show "already signed" before connect.
app.post('/admin/signing-identities', async (c) => {
  try {
    const keys = await mcp(c.env, '/tools/content_signer_keys', {});
    const stored = await mcp(c.env, '/tools/list_content_signers', {});
    const signers = (keys.signers as Array<{ issuerName: string; issuerSa: string; delegateKey: string }>) ?? [];
    const rows = (stored.signers as Array<{ issuer_name: string; issuer_sa: string; delegate_key: string; updated_at: string }>) ?? [];
    const byName = new Map(rows.map((r) => [r.issuer_name.toLowerCase(), r]));
    const roster = signers.map((s) => {
      const row = byName.get(s.issuerName.toLowerCase());
      // authorized ONLY when a stored leaf binds BOTH the current SA (name re-points/SA changes invalidate it)
      // AND the current KMS delegate key (key rotation invalidates it). Either drift ⇒ re-authorize.
      const authorized = !!row
        && row.issuer_sa.toLowerCase() === s.issuerSa.toLowerCase()
        && row.delegate_key.toLowerCase() === s.delegateKey.toLowerCase();
      return { issuerName: s.issuerName, issuerSa: s.issuerSa, delegateKey: s.delegateKey, authorized, updatedAt: row?.updated_at ?? null };
    });
    return c.json({ ok: true, roster });
  } catch (e) { return c.json({ ok: false, error: (e as Error).message }, 503); }
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
.ownb{border-radius:10px;padding:11px 14px;margin-bottom:14px;font-size:14px}
.own-yes{background:#e9f7ef;border:1px solid #b7e2c8;color:#136c3a}.own-no{background:#fff5e9;border:1px solid #f0d3a8;color:#8a5510}
.fbfilters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:11px}
.fbfilters select,.fbfilters input{padding:6px 9px;border:1px solid var(--line);border-radius:7px;font-size:13px}
.fbfilters input{flex:1;min-width:170px}
.fbitem{border:1px solid var(--line);border-radius:9px;padding:9px 11px;margin-bottom:8px}
.fb-st{display:inline-block;padding:1px 7px;border-radius:6px;font-size:11px;font-weight:600;color:#fff}
.fb-challenge{background:#c0392b}.fb-agree{background:#1a8a4f}.fb-note{background:#64748b}
.topnav{display:flex;gap:2px;background:#fff;border-bottom:1px solid var(--line);padding:0 20px}
.navlink{padding:11px 16px;cursor:pointer;font-size:14px;font-weight:600;color:var(--muted);border-bottom:2px solid transparent;margin-bottom:-1px;user-select:none}
.navlink:hover{color:#1a2433}.navlink.active{color:var(--accent);border-bottom-color:var(--accent)}
.cpick{max-width:580px;margin:46px auto;text-align:center}.cpick h2{font-size:20px;margin:0 0 6px}
.cpickbtns{display:flex;gap:14px;justify-content:center;margin-top:22px;flex-wrap:wrap}
.cpickcard{flex:1;min-width:190px;border:1px solid var(--line);border-radius:12px;padding:20px;cursor:pointer;background:#fff;text-align:left}
.cpickcard:hover{border-color:var(--accent);box-shadow:0 2px 12px rgba(47,109,240,.14)}.cpickcard b{font-size:16px;display:block}
.chipbtn{cursor:pointer;color:var(--accent);font-weight:600}
/* Top-right account menu (matches demo-bible-ontology) */
.acctmenu{position:relative;display:inline-block}
.acctmenu-trigger{display:inline-flex;align-items:center;gap:7px;background:#fff;border:1px solid var(--line);border-radius:9px;padding:6px 11px;font:inherit;font-size:13px;font-weight:600;color:#1a2433;cursor:pointer}
.acctmenu-trigger:hover{border-color:#d0dbf5;background:#f8fafd}
.acctmenu-dot{color:#1a8a4f;font-size:10px}
.acctmenu-caret{color:var(--muted);font-size:10px}
.acctmenu-lbl{max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.acctmenu-pop{display:none;position:absolute;top:calc(100% + 6px);right:0;z-index:60;min-width:280px;background:#fff;border:1px solid var(--line);border-radius:11px;box-shadow:0 10px 30px rgba(20,30,50,.18);overflow:hidden}
.acctmenu-pop.open{display:block}
.acctmenu-head{padding:12px 14px;border-bottom:1px solid var(--line);background:#f8fafd}
.acctmenu-name{font-weight:700;font-size:14px;color:#1a2433}
.acctmenu-row{margin-top:8px}
.acctmenu-k{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:700}
.acctmenu-v{font-size:12px;color:#1a2433;word-break:break-all;line-height:1.35}
.acctmenu-mono{font-family:ui-monospace,Menlo,monospace}
.acctmenu-item{display:block;width:100%;text-align:left;background:transparent;border:0;border-radius:0;padding:10px 14px;font:inherit;font-size:13px;font-weight:600;color:#1a2433;cursor:pointer}
.acctmenu-item:hover{background:#eef2fb;color:var(--accent)}
.acctmenu-item.danger{color:#c0392b;border-top:1px solid var(--line)}
.acctmenu-item.danger:hover{background:#fdecea;color:#c0392b}
</style></head><body>
<div class="hdr"><h1>🗂️ Corpus Manager</h1><span class="sub" id="hsub">entitlement approvals</span><span id="who"></span></div>
<nav class="topnav" id="topnav"><a id="nav-ent" class="navlink active" onclick="showPage('ent')">Entitlements</a><a id="nav-fb" class="navlink" onclick="showPage('fb')">Feedback</a><a id="nav-sign" class="navlink" onclick="showPage('sign')">Signing identities</a><a id="nav-tre" class="navlink" onclick="showPage('tre')">Treasury</a><span id="corpchip" style="margin-left:auto;align-self:center;font-size:13px"></span></nav>
<main>
<div id="corpuspick" style="display:none"></div>
<div id="owner"></div>
<div id="page-ent">
<div class="card"><h3 style="margin-top:0">Requests queue</h3>
<p class="muted" style="font-size:13px">Readers request access to licensed editions from inside the Bible Explorer. Approve to issue a signed, time-boxed entitlement to that reader; deny to decline. Only the corpus owner may act.</p>
<div id="queue"></div></div>
<div class="card"><h3 style="margin-top:0">Issued entitlements</h3>
<p class="muted" style="font-size:13px">Live grants. Revoking is immediate — gated reads re-check this ledger and fail closed.</p>
<div id="issued"></div></div>
</div>
<div id="page-fb" style="display:none">
<div class="card"><h3 style="margin-top:0">Trust-signal feedback</h3>
<p class="muted" style="font-size:13px">Every signed feedback assertion posted across the corpus — readers challenging or affirming a trust signal on a specific (entity, signal, verse) triple. Filter to review.</p>
<div class="fbfilters">
<select id="fb-stance" onchange="loadFeedback()"><option value="">all stances</option><option value="challenge">challenge</option><option value="agree">agree</option><option value="note">note</option></select>
<input id="fb-q" placeholder="filter by author SA / entity id…" oninput="fbDebounce()">
<button onclick="loadFeedback()">Refresh</button></div>
<div id="fblist"><p class="muted">Connect as the corpus owner to review feedback.</p></div></div>
</div>
<div id="page-sign" style="display:none">
<div class="card"><h3 style="margin-top:0">Signing identities · authorize the keys</h3>
<p class="muted" style="font-size:13px">Every signing identity on the platform — content issuers (<span class="mono">fbsb.impact</span>, <span class="mono">lbsb.impact</span>), the independent validator (<span class="mono">demo-validator.impact</span>), and the resolver agent (<span class="mono">scripture-resolver.impact</span>) — signs with a key held in an <b>HSM-backed Cloud KMS</b>; the key never leaves the HSM. Authorize once: <b>one ceremony</b> signs, with your own credential, a delegation binding each SA you custody → its HSM signing key. Each service then signs its credentials <i>as the right identity</i>, with no held private key.</p>
<div id="signroster" style="margin:10px 0"><p class="muted" style="font-size:13px">Loading signing-identity status…</p></div>
<div id="csstat" class="ownb" style="background:#eefbf3;border:1px solid #cfeede;color:#1d6b45">—</div>
<div style="margin:8px 0"><button class="ap" id="csBtn" onclick="authorizeContentSigning()">Authorize content signing</button></div></div>
</div>
<div id="page-tre" style="display:none">
<div class="card"><h3 style="margin-top:0">Subscriptions · collect what's due</h3>
<p class="muted" style="font-size:13px">Each subscriber authorized a standing <b>charge mandate</b> (their treasury → your <span class="mono">lbsb-treasury.impact</span>) at subscribe time. When a period ends, you collect: <b>one ceremony</b> signs the redemption of every due mandate with your own credential — no held key, no per-subscriber prompt.</p>
<div id="substat" class="ownb" style="background:#f3f0ff;border:1px solid #d9d2f5;color:#4b2e83">—</div>
<div style="margin:8px 0"><button class="ap" id="chargeBtn" onclick="chargeDueSubscriptions()">Charge due subscriptions</button> <button onclick="loadSubscriptions()">Refresh</button></div>
<div id="sublist"><p class="muted">Connect as the corpus owner to view subscriptions.</p></div></div>
<div class="card"><h3 style="margin-top:0">Treasury · x402 settlements</h3>
<p class="muted" style="font-size:13px">Per-use payments + subscription charges collected for this corpus's licensed edition — money lands at the <b>lbsb-treasury.impact</b> agent. This ledger fills as charges settle.</p>
<div id="trestat" class="ownb" style="background:#eef3fb;border:1px solid #d4e0f5;color:#27457e">—</div>
<div id="trelist"><p class="muted">Connect as the corpus owner to view the treasury.</p></div></div>
</div>
</main>
<script>
const esc=(s)=>String(s==null?'':s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const CONNECT_DOMAIN='churchcore.me',CLIENT_ID='demo-corpus',CENTRAL_AUTH_ORIGIN='https://www.'+CONNECT_DOMAIN,CONNECT_DELEGATE='0x89D13c596c45E4eE80Af5ae06C727FE9A820ffD0';
// The content service exposing the owner-gated subscription due/collected endpoints (verified on-chain).
const A2A_BASE='https://demo-bible-a2a-production.richardpedersen3.workers.dev';
// Corpus → licensed edition the subscriptions live under (matches the a2a EDITION_SERVICE map).
function editionOf(){return corpusKey==='lbsb'?'lbsb':(corpusKey==='bsb'?'demo-licensed':'lbsb');}
// Corpora this manager administers. Pick one FIRST, then connect AS that corpus's service agent (the
// manager signs in at <short>.impact-agent.me as <agent>); the claim verifies custody via agent-naming.
const CORPORA=[{key:'bsb',label:'BSB',short:'bsb',agent:'fbsb.impact'},{key:'lbsb',label:'Licensed BSB',short:'lbsb',agent:'lbsb.impact'},{key:'validator',label:'Validator',short:'validator',agent:'demo-validator.impact'},{key:'resolver',label:'Resolver agent',short:'scripture-resolver',agent:'scripture-resolver.impact'}];
let corpusKey=localStorage.getItem('corp.corpus')||'';
function curCorpus(){return CORPORA.filter(x=>x.key===corpusKey)[0]||null;}
let session=null;
function loadSession(){try{const j=JSON.parse(localStorage.getItem('corp.session')||'null');session=(j&&j.exp*1000>Date.now())?j:null;if(!session)localStorage.removeItem('corp.session');}catch(e){session=null;}}
function isConnected(){return !!session;}
function b64url(b){let s='';for(let i=0;i<b.length;i++)s+=String.fromCharCode(b[i]);return btoa(s).split('+').join('-').split('/').join('_').replace(/=+$/,'');}
function fromB64url(seg){const bin=atob(seg.split('-').join('+').split('_').join('/'));const o=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)o[i]=bin.charCodeAt(i);return o;}
function decodeSeg(seg){return JSON.parse(new TextDecoder().decode(fromB64url(seg)));}
const randB64=(n)=>b64url(crypto.getRandomValues(new Uint8Array(n)));
async function pkce(){const v=randB64(32);const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v));return {verifier:v,challenge:b64url(new Uint8Array(d))};}
function isAllowedIssuer(origin){try{const u=new URL(origin);if(u.protocol!=='https:'&&u.hostname!=='localhost'&&u.hostname!=='127.0.0.1')return false;if(u.pathname!=='/'&&u.pathname!=='')return false;const h=u.hostname;return h===CONNECT_DOMAIN||h.endsWith('.'+CONNECT_DOMAIN)||h==='localhost'||h==='127.0.0.1';}catch(e){return false;}}
// Sign in as the manager's OWN identity at www (NOT "as the agent" — that home hangs). The claim then
// verifies on-chain that this identity custodies the selected corpus's service agent.
async function connectStart(){const cp=curCorpus();if(!cp){alert('Pick a corpus to manage first.');return;}
  const state=randB64(16),nonce=randB64(16),pk=await pkce();
  sessionStorage.setItem('corp.pending',JSON.stringify({state,nonce,verifier:pk.verifier,authOrigin:CENTRAL_AUTH_ORIGIN}));
  const u=new URL('/',CENTRAL_AUTH_ORIGIN);u.searchParams.set('client_id',CLIENT_ID);u.searchParams.set('redirect_uri',location.origin+'/');u.searchParams.set('response_type','code');u.searchParams.set('scope','openid agent');u.searchParams.set('state',state);u.searchParams.set('nonce',nonce);u.searchParams.set('code_challenge',pk.challenge);u.searchParams.set('code_challenge_method','S256');u.searchParams.set('agent_name','');u.searchParams.set('delegate',CONNECT_DELEGATE);u.searchParams.set('delegation_template','site-login');location.href=u.toString();}
// fetch with a hard timeout so a slow/looping home can never hang the page (browser-kill).
async function tfetch(url,opts,ms){const ctrl=new AbortController();const t=setTimeout(()=>ctrl.abort(),ms||12000);try{return await fetch(url,Object.assign({signal:ctrl.signal},opts||{}));}finally{clearTimeout(t);}}
async function verifyIdToken(authOrigin,idToken,expectedNonce){
  const parts=idToken.split('.');if(parts.length!==3)throw new Error('malformed');
  const header=decodeSeg(parts[0]),claims=decodeSeg(parts[1]);
  const iss=String(claims.iss||'');if(!isAllowedIssuer(iss))throw new Error('issuer not allowed: '+iss);
  const base=iss.endsWith('/')?iss.slice(0,-1):iss;
  const jwks=await tfetch(base+'/jwks').then(r=>r.json());const jwk=(jwks.keys||[]).find(k=>k.kid===header.kid);if(!jwk)throw new Error('no key');
  if(jwk.alg!=='ES256'||header.alg!=='ES256')throw new Error('alg');
  const key=await crypto.subtle.importKey('jwk',jwk,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
  const ok=await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,fromB64url(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1]));
  if(!ok)throw new Error('signature');if(claims.aud!==CLIENT_ID)throw new Error('aud');if(expectedNonce&&claims.nonce!==expectedNonce)throw new Error('nonce');if(typeof claims.exp!=='number'||claims.exp*1000<Date.now())throw new Error('expired');return claims;}
async function connectCallback(){const p=new URLSearchParams(location.search);const code=p.get('code'),state=p.get('state');if(!code||!state)return false;
  let pend=null;try{pend=JSON.parse(sessionStorage.getItem('corp.pending')||'null');}catch(e){}
  history.replaceState(null,'',location.pathname);
  if(!pend||pend.state!==state)return false;
  try{const ao=pend.authOrigin||OWNER_HOME;const tr=await tfetch((ao.endsWith('/')?ao.slice(0,-1):ao)+'/token',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({grant_type:'authorization_code',code,code_verifier:pend.verifier,client_id:CLIENT_ID,redirect_uri:location.origin+'/'})},15000).then(r=>r.json());
    if(!tr.id_token)throw new Error(tr.error||'no id_token');
    const claims=await verifyIdToken(ao,tr.id_token,pend.nonce);
    session={idToken:tr.id_token,name:claims.agent_name||'',sub:claims.canonical_agent_id||claims.sub||'',exp:claims.exp};
    localStorage.setItem('corp.session',JSON.stringify(session));sessionStorage.removeItem('corp.pending');return true;
  }catch(e){alert('Connect failed: '+(e&&e.message?e.message:e));return false;}}
function disconnect(){session=null;localStorage.removeItem('corp.session');render();}
// Top-right account dropdown (matches demo-bible-ontology): the connected SMART AGENT identity — its name,
// its on-chain address, and the canonical (CAIP-10) agent id — plus Disconnect. (The custodian EOA is NOT
// part of the OIDC agent session by design — ADR-0016 — so the menu shows the smart-agent identity.)
const acctAddr=()=>{const m=String(session&&session.sub||'').match(/0x[0-9a-fA-F]{40}/);return m?m[0]:'';};
function acctMenuHTML(){
  const nm=esc(session.name||(session.sub||'').slice(0,16)),did=esc(session.sub||''),sa=acctAddr();
  return '<div class="acctmenu"><button class="acctmenu-trigger" onclick="toggleAcctMenu(event)"><span class="acctmenu-dot">●</span><span class="acctmenu-lbl">'+nm+'</span><span class="acctmenu-caret">▾</span></button>'+
    '<div class="acctmenu-pop" id="acctmenuPop"><div class="acctmenu-head"><div class="acctmenu-name">'+nm+'</div>'+
      '<div class="acctmenu-row"><span class="acctmenu-k">Smart agent name</span><span class="acctmenu-v">'+nm+'</span></div>'+
      '<div class="acctmenu-row"><span class="acctmenu-k">Smart agent address</span><span class="acctmenu-v acctmenu-mono">'+esc(sa||'—')+'</span></div>'+
      '<div class="acctmenu-row"><span class="acctmenu-k">Canonical agent id</span><span class="acctmenu-v acctmenu-mono">'+did+'</span></div>'+
    '</div><button class="acctmenu-item danger" onclick="closeAcctMenu();disconnect()">Disconnect</button></div></div>';
}
function toggleAcctMenu(e){if(e){e.stopPropagation();}const p=document.getElementById('acctmenuPop');if(p)p.classList.toggle('open');}
function closeAcctMenu(){const p=document.getElementById('acctmenuPop');if(p)p.classList.remove('open');}
document.addEventListener('click',function(e){const p=document.getElementById('acctmenuPop');if(p&&p.classList.contains('open')&&!e.target.closest('.acctmenu'))p.classList.remove('open');});
// Auto-scope every /admin call to the selected corpus.
const post=(p,b)=>tfetch(p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(p.indexOf('/admin')===0?Object.assign({corpus:corpusKey},b||{}):b)},10000).then(r=>r.json());
function pickCorpus(k){corpusKey=k;localStorage.setItem('corp.corpus',k);renderPicker();render();}
function switchCorpus(){corpusKey='';localStorage.removeItem('corp.corpus');renderPicker();render();}
// Show the corpus picker when none is chosen; otherwise reveal the nav + pages for the chosen corpus.
function renderPicker(){
  const pk=document.getElementById('corpuspick'),nv=document.getElementById('topnav'),pe=document.getElementById('page-ent'),pf=document.getElementById('page-fb'),ob=document.getElementById('owner'),chip=document.getElementById('corpchip'),hsub=document.getElementById('hsub');
  const cp=curCorpus();
  if(!cp){
    if(nv)nv.style.display='none';if(pe)pe.style.display='none';if(pf)pf.style.display='none';if(ob)ob.style.display='none';if(chip)chip.innerHTML='';if(hsub)hsub.textContent='select a corpus';
    if(pk){pk.style.display='block';pk.innerHTML='<div class="cpick"><h2>Which identity do you manage?</h2><p class="muted" style="font-size:14px">Pick a corpus or signing identity, then connect as its custodian. Only that identity\\'s custodian can administer it or authorize its signing key.</p><div class="cpickbtns">'+CORPORA.map(x=>'<div class="cpickcard" onclick="pickCorpus(\\''+x.key+'\\')"><b>'+esc(x.label)+'</b><span class="muted" style="font-size:12px">connect as <span class="mono">'+esc(x.agent)+'</span></span></div>').join('')+'</div></div>';}
  }else{
    if(pk){pk.style.display='none';pk.innerHTML='';}if(nv)nv.style.display='';if(ob)ob.style.display='';
    if(chip)chip.innerHTML='<span class="muted">'+esc(cp.label)+' · '+esc(cp.agent)+'</span> · <span class="chipbtn" onclick="switchCorpus()">switch</span>';
    if(hsub)hsub.textContent=cp.label+' · entitlement approvals';
  }
}
async function loadQueue(){const el=document.getElementById('queue');if(!el)return;
  if(!isConnected()){el.innerHTML='<p class="muted">Connect as the corpus owner to review requests.</p>';return;}
  el.innerHTML='<p class="muted">loading…</p>';
  const r=await post('/admin/requests',{id_token:session.idToken}).catch(e=>({ok:false,error:String(e)}));
  if(!r||!r.ok){el.innerHTML='<p style="color:#c0392b">'+esc((r&&r.error)||'failed')+'</p>';return;}
  const reqs=r.requests||[];
  el.innerHTML=reqs.length?reqs.map(q=>'<div class="req"><div><b>'+esc(q.edition)+'</b> <span class="muted">'+esc(q.subject_name||q.subject)+'</span><div class="muted" style="font-size:11px">'+esc(q.note||'')+' · '+esc((q.created_at||'').slice(0,16).replace('T',' '))+'</div></div><div class="acts"><select id="ttl'+q.id+'"><option value="3600">1 hour</option><option value="86400" selected>1 day</option><option value="2592000">30 days</option></select><button class="ap" onclick="approve('+q.id+')">Approve</button><button class="dn" onclick="deny('+q.id+')">Deny</button></div></div>').join(''):'<p class="muted">No pending requests.</p>';}
async function approve(id){const sel=document.getElementById('ttl'+id);const ttl=parseInt(sel?sel.value:'86400',10)||86400;const r=await post('/admin/approve',{id_token:session.idToken,requestId:id,ttlSeconds:ttl}).catch(e=>({ok:false,error:String(e)}));if(r&&r.ok)loadQueue();else alert('Approve failed: '+((r&&r.error)||'?'));}
async function deny(id){const reason=prompt('Deny reason (optional):','')||'';const r=await post('/admin/deny',{id_token:session.idToken,requestId:id,reason:reason}).catch(e=>({ok:false,error:String(e)}));if(r&&r.ok)loadQueue();else alert('Deny failed: '+((r&&r.error)||'?'));}
async function loadIssued(){const el=document.getElementById('issued');if(!el)return;
  if(!isConnected()){el.innerHTML='<p class="muted">Connect to view issued entitlements.</p>';return;}
  const r=await post('/admin/issued',{id_token:session.idToken}).catch(e=>({ok:false,error:String(e)}));
  if(!r||!r.ok){el.innerHTML='<p style="color:#c0392b">'+esc((r&&r.error)||'failed')+'</p>';return;}
  const rows=r.issued||[];
  el.innerHTML=rows.length?rows.map(x=>'<div class="req"><div><b>'+esc(x.edition)+'</b> <span class="muted">'+esc(x.subject)+'</span><div class="muted" style="font-size:11px">until '+esc((x.valid_until||'').slice(0,10))+' · issued '+esc((x.created_at||'').slice(0,10))+'</div></div><div class="acts"><button class="dn" onclick="revoke('+x.id+')">Revoke</button></div></div>').join(''):'<p class="muted">No active entitlements.</p>';}
async function revoke(id){if(!confirm('Revoke this entitlement? The reader loses access immediately.'))return;const r=await post('/admin/revoke',{id_token:session.idToken,id:id}).catch(e=>({ok:false,error:String(e)}));if(r&&r.ok)loadIssued();else alert('Revoke failed: '+((r&&r.error)||'?'));}
async function render(){
  const cp=curCorpus();
  const w=document.getElementById('who');
  if(w)w.innerHTML=!cp?'':(isConnected()?acctMenuHTML():'<button class="conn" onclick="connectStart()">🌐 Connect with Global.Church</button>');
  if(!cp)return;
  const ob=document.getElementById('owner'),q=document.getElementById('queue'),is=document.getElementById('issued');
  if(!isConnected()){window.isOwnerNow=false;if(ob)ob.innerHTML='<div class="ownb">Connect with your <b>custodian identity</b> for <span class="mono">'+esc(cp.agent)+'</span> to manage the '+esc(cp.label)+' corpus. (We verify custody on-chain — no need to sign in as the agent.)</div>';if(q)q.innerHTML='<p class="muted">Connect as the corpus owner to review requests.</p>';if(is)is.innerHTML='';return;}
  if(ob)ob.innerHTML='<div class="ownb">checking corpus ownership…</div>';
  const cl=await post('/admin/claim',{id_token:session.idToken}).catch(e=>({ok:false,error:String(e)}));
  const fbl=document.getElementById('fblist');
  if(cl&&cl.ok&&cl.isOwner){
    window.isOwnerNow=true;
    if(ob)ob.innerHTML='<div class="ownb own-yes">'+(cl.claimed?'🎉 You just <b>claimed the '+esc(cp.label)+' corpus</b> — you are the owner.':'✓ You are the <b>'+esc(cp.label)+' corpus owner</b> ('+esc(cp.agent)+').')+'</div>';
    loadQueue();loadIssued();loadFeedback();loadTreasury();loadSubscriptions();
    const cs=document.getElementById('csstat');if(cs)cs.innerHTML='Ready to authorize. The ceremony binds each SA you custody (e.g. <b>lbsb.impact</b>, <b>demo-validator.impact</b>) to its <b>HSM-backed Cloud KMS</b> signing key — one signing, revocable later.';
  }else{
    window.isOwnerNow=false;
    if(ob)ob.innerHTML='<div class="ownb own-no">'+esc(cp.label)+' is owned by <span class="mono">'+esc((cl&&cl.ownerSub||'').slice(0,20))+'…</span> — you are not the owner'+((cl&&cl.reason)?' ('+esc(cl.reason)+')':'')+'.</div>';
    if(q)q.innerHTML='<p class="muted">Only the corpus owner can review requests.</p>';if(is)is.innerHTML='';
    if(fbl)fbl.innerHTML='<p class="muted">Only the corpus owner can review feedback.</p>';
    const tr=document.getElementById('trelist');if(tr)tr.innerHTML='<p class="muted">Only the corpus owner can view the treasury.</p>';
    const sl=document.getElementById('sublist');if(sl)sl.innerHTML='<p class="muted">Only the corpus owner can view subscriptions.</p>';const ss=document.getElementById('substat');if(ss)ss.innerHTML='—';const cs=document.getElementById('csstat');if(cs)cs.innerHTML='—';
  }
}
let fbTimer=null;
function fbDebounce(){if(fbTimer)clearTimeout(fbTimer);fbTimer=setTimeout(loadFeedback,400);}
async function loadFeedback(){
  const el=document.getElementById('fblist');if(!el)return;
  if(!window.isOwnerNow){el.innerHTML='<p class="muted">Only the corpus owner can review feedback.</p>';return;}
  const stance=(document.getElementById('fb-stance')||{}).value||'';
  const q=((document.getElementById('fb-q')||{}).value||'').trim();
  el.innerHTML='<p class="muted">loading…</p>';
  const body={id_token:session.idToken,stance:stance};
  if(q){if(q.indexOf('eip155:')===0||q.indexOf('0x')===0)body.author=q;else body.subject=q;}
  const r=await post('/admin/feedback',body).catch(e=>({ok:false,error:String(e)}));
  if(!r||!r.ok){el.innerHTML='<p style="color:#c0392b">'+esc((r&&r.error)||'failed')+'</p>';return;}
  const fb=r.feedback||[];
  if(!fb.length){el.innerHTML='<p class="muted">No feedback matches these filters.</p>';return;}
  el.innerHTML='<div class="muted" style="font-size:12px;margin-bottom:7px">'+fb.length+' item'+(fb.length===1?'':'s')+'</div>'+fb.map(fbRow).join('');
}
function fbRow(f){return '<div class="fbitem"><span class="fb-st fb-'+esc(f.stance)+'">'+esc(f.stance)+'</span> '+(f.verdict?'<span class="fb-st" style="background:#475569">'+esc(f.verdict)+'</span> ':'')+'<b>'+esc(f.subject_label||f.subject_id||'')+'</b>'+(f.osis?' <span class="muted" style="font-size:11px">'+esc(f.osis)+'</span>':'')+(f.signed?' <span style="color:#1a8a4f;font-size:11px" title="signed assertion">✓ signed</span>':'')+
  '<div style="font-size:13px;margin-top:3px;white-space:pre-wrap">'+esc(f.comment||'')+'</div>'+
  '<div class="muted" style="font-size:11px;margin-top:4px">by <b>'+esc(f.author||'anonymous')+'</b>'+(f.author_sub?' <span class="mono">'+esc(String(f.author_sub).slice(0,18))+'…</span>':'')+' · '+esc((f.created_at||'').slice(0,10))+(f.sig_kind?' · signal '+esc(f.sig_kind):'')+'</div></div>';}
// Client-side pages: Entitlements (default) and Feedback (#feedback) — toggle + hash-route.
const PAGES={ent:['page-ent','nav-ent','#entitlements'],fb:['page-fb','nav-fb','#feedback'],sign:['page-sign','nav-sign','#signing'],tre:['page-tre','nav-tre','#treasury']};
function showPage(name){
  if(!PAGES[name])name='ent';
  Object.keys(PAGES).forEach(function(k){const p=document.getElementById(PAGES[k][0]);if(p)p.style.display=(k===name)?'':'none';const n=document.getElementById(PAGES[k][1]);if(n)n.className='navlink'+(k===name?' active':'');});
  const want=PAGES[name][2];if(location.hash!==want)history.replaceState(null,'',location.pathname+want);
  if(name==='fb'&&window.isOwnerNow)loadFeedback();
  if(name==='tre'&&window.isOwnerNow){loadTreasury();loadSubscriptions();}
  if(name==='sign')loadSigningIdentities();}
function route(){const h=location.hash;showPage(h==='#feedback'?'fb':h==='#signing'?'sign':h==='#treasury'?'tre':'ent');}
async function loadTreasury(){
  const el=document.getElementById('trelist'),st=document.getElementById('trestat');if(!el)return;
  if(!window.isOwnerNow){el.innerHTML='<p class="muted">Only the corpus owner can view the treasury.</p>';if(st)st.innerHTML='—';return;}
  el.innerHTML='<p class="muted">loading…</p>';
  const r=await post('/admin/treasury',{id_token:session.idToken}).catch(e=>({ok:false,error:String(e)}));
  if(!r||!r.ok){el.innerHTML='<p style="color:#c0392b">'+esc((r&&r.error)||'failed')+'</p>';return;}
  const s=r.settlements||[];
  if(st)st.innerHTML='Gross collected: <b>'+esc(r.total||'0')+'</b> atomic units · <b>'+s.length+'</b> settlement'+(s.length===1?'':'s')+' (this edition)';
  el.innerHTML=s.length?s.map(x=>'<div class="req"><div><b>'+esc(x.amount||'?')+'</b> <span class="muted">'+esc(x.asset||'')+'</span> · <span class="fb-st" style="background:#475569;color:#fff">'+esc(x.lane||'settlement')+'</span> '+esc(x.reference||'')+'<div class="muted" style="font-size:11px">from <span class="mono">'+esc(String(x.payer||'').slice(0,18))+'…</span>'+(x.settlement_hash?' · tx <span class="mono">'+esc(String(x.settlement_hash).slice(0,12))+'…</span>':'')+' · '+esc((x.created_at||'').slice(0,16))+'</div></div></div>').join(''):'<p class="muted">No settlements yet. They appear here once pay-per-use is activated and readers pay to access the licensed edition.</p>';}
// ── Subscriptions: list what's due + launch the owner collection ceremony ──
// The due-list + balances are READ straight from the content service (a2a), owner-gated by the owner's
// id_token (aud=demo-corpus, accepted). Collection itself runs in the HOME (it holds the credential).
async function loadSubscriptions(){
  const el=document.getElementById('sublist'),st=document.getElementById('substat');if(!el)return;
  if(!window.isOwnerNow){el.innerHTML='<p class="muted">Only the corpus owner can view subscriptions.</p>';if(st)st.innerHTML='—';return;}
  el.innerHTML='<p class="muted">loading…</p>';
  // Show ALL active subscriptions (the subscriber base) + flag which are DUE for a period charge.
  const r=await tfetch(A2A_BASE+'/admin/subscriptions/list',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id_token:session.idToken,edition:editionOf()})},12000).then(x=>x.json()).catch(e=>({ok:false,error:String(e)}));
  if(!r||!r.ok){el.innerHTML='<p style="color:#c0392b">'+esc((r&&r.error)||'failed')+'</p>';if(st)st.innerHTML='—';return;}
  const subs=r.subscriptions||[],due=subs.filter(function(s){return s.due;});
  const btn=document.getElementById('chargeBtn');if(btn)btn.disabled=!due.length;
  if(st)st.innerHTML='<b>'+subs.length+'</b> active subscription'+(subs.length===1?'':'s')+' · <b>'+due.length+'</b> due for a period charge'+(due.length?' — click <b>Charge due subscriptions</b> to bill them in one signing.':'.');
  el.innerHTML=subs.length?subs.map(function(s){
    const cap=Number(s.reads_per_period||0),used=Number(s.period_uses||0);
    return '<div class="req"><div><b>'+esc(s.tier_label||s.tier||'subscription')+'</b> '+(s.due?'<span class="fb-st" style="background:#b45309;color:#fff">due now</span>':'<span class="fb-st" style="background:#475569;color:#fff">active</span>')+' <span class="muted">'+esc(String(s.subject||'').slice(0,24))+'…</span>'+
      '<div class="muted" style="font-size:11px">'+(Number(s.amount_per_period||0)/1e6)+' USDC / period · fair-use '+used+'/'+cap+' reads used this period · '+(s.due?'<b style="color:#b45309">charge due since</b> ':'next charge ')+esc(String(s.current_period_end||'').slice(0,10))+'</div></div></div>';
  }).join(''):'<p class="muted">No active subscriptions yet. They appear here once a reader subscribes in the Bible Explorer.</p>';
}
// Charge due subscriptions: hand off to the HOME collection ceremony. The home recognizes the owner,
// they authorize once, and it redeems every due mandate AS lbsb-treasury (owner credential, no held key),
// then redirects back here with ?collect=1&collected=N. The owner id_token rides as collect_token so the
// home can drive the owner-gated a2a calls.
async function chargeDueSubscriptions(){
  if(!window.isOwnerNow){alert('Connect as the corpus owner first.');return;}
  const state=randB64(16),nonce=randB64(16),pk=await pkce();
  sessionStorage.setItem('corp.collect',JSON.stringify({state}));
  const u=new URL('/',CENTRAL_AUTH_ORIGIN);u.searchParams.set('client_id',CLIENT_ID);u.searchParams.set('redirect_uri',location.origin+'/');u.searchParams.set('response_type','code');u.searchParams.set('scope','openid agent');u.searchParams.set('state',state);u.searchParams.set('nonce',nonce);u.searchParams.set('code_challenge',pk.challenge);u.searchParams.set('code_challenge_method','S256');u.searchParams.set('agent_name','');u.searchParams.set('delegate',CONNECT_DELEGATE);u.searchParams.set('delegation_template','subscription-collect');u.searchParams.set('collect_token',session.idToken);
  location.href=u.toString();
}
// Roster of every signing identity + which have ALREADY authorized (stored) their HSM-KMS delegation.
// Non-secret platform status — loads whenever the Signing identities tab is shown, even before connect.
async function loadSigningIdentities(){
  const el=document.getElementById('signroster');if(!el)return;
  const r=await post('/admin/signing-identities',{}).catch(function(e){return {ok:false,error:String(e)};});
  if(!r||!r.ok){el.innerHTML='<p class="muted" style="font-size:13px">Could not load signing-identity status'+(r&&r.error?': '+esc(r.error):'')+'.</p>';return;}
  const roster=r.roster||[];const cur=String(((curCorpus()||{}).agent)||'').toLowerCase();
  const done=roster.filter(function(x){return x.authorized;}).length;
  const rows=roster.map(function(x){
    const isCur=x.issuerName.toLowerCase()===cur;
    const badge=x.authorized
      ?'<span style="background:#e6f7ee;color:#1d6b45;border:1px solid #bfe6cf;border-radius:10px;padding:2px 9px;font-size:12px;font-weight:600;white-space:nowrap">&#10003; Authorized</span>'
      :'<span style="background:#fff5e6;color:#8a5a00;border:1px solid #f0dcb0;border-radius:10px;padding:2px 9px;font-size:12px;font-weight:600;white-space:nowrap">Not yet authorized</span>';
    const when=x.authorized&&x.updatedAt?'<span class="muted" style="font-size:11px"> &middot; '+esc(String(x.updatedAt).slice(0,10))+'</span>':'';
    return '<div style="display:flex;align-items:center;gap:10px;padding:9px 11px;border:1px solid var(--line);border-radius:8px;margin-bottom:6px'+(isCur?';background:#f6faff;border-color:#cfe0f5':'')+'">'
      +'<div style="flex:1;min-width:0"><div style="font-weight:600"><span class="mono">'+esc(x.issuerName)+'</span>'+(isCur?' <span class="muted" style="font-size:11px">&middot; connected</span>':'')+'</div>'
      +'<div class="muted" style="font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">SA '+esc(x.issuerSa)+' &rarr; HSM key '+esc(x.delegateKey)+'</div></div>'
      +badge+when+'</div>';
  }).join('');
  el.innerHTML='<div class="muted" style="font-size:12px;margin-bottom:6px"><b>'+done+' of '+roster.length+'</b> signing identities bound to their HSM-backed Cloud KMS key</div>'+rows;
}
// Authorize content signing: hand off to the HOME content-signer ceremony. The home recognizes the
// owner, fetches each issuer's KMS signing-key address, and the owner signs (with their own credential,
// per issuer they custody) the issuer SA → key delegation; the content service stores it. No held key.
async function authorizeContentSigning(){
  if(!window.isOwnerNow){alert('Connect as this identity\\'s custodian first.');return;}
  const cp=curCorpus();
  const state=randB64(16),nonce=randB64(16),pk=await pkce();
  sessionStorage.setItem('corp.collect',JSON.stringify({state}));
  // PER-CUSTODIAN: authorize ONLY the identity you connected as (its custodian can sign just its SA's leaf).
  const u=new URL('/',CENTRAL_AUTH_ORIGIN);u.searchParams.set('client_id',CLIENT_ID);u.searchParams.set('redirect_uri',location.origin+'/');u.searchParams.set('response_type','code');u.searchParams.set('scope','openid agent');u.searchParams.set('state',state);u.searchParams.set('nonce',nonce);u.searchParams.set('code_challenge',pk.challenge);u.searchParams.set('code_challenge_method','S256');u.searchParams.set('agent_name','');u.searchParams.set('delegate',CONNECT_DELEGATE);u.searchParams.set('delegation_template','content-signer');u.searchParams.set('collect_token',session.idToken);u.searchParams.set('content_signer_target',cp.agent);
  // NO prompt=select_account here: the CONNECT (nameless site-login) already chose the custodian + set the
  // session; forcing the chooser again routes content-signer through EntryExperience (which can't run the
  // ceremony → returns a bare ?code). Instead reuse the recognized session; signHashFor → connectCustodianWallet
  // picks the account that custodies the target SA (0xad93 for demo-validator.impact's 0x4848).
  location.href=u.toString();
}
// On return from the collection ceremony (?collect=1&collected=N), surface the result + refresh.
function collectCallback(){
  const p=new URLSearchParams(location.search);if(p.get('collect')!=='1')return false;
  const collected=p.get('collected')||'0',attempted=p.get('attempted')||'0',kind=p.get('collect_kind')||'';
  history.replaceState(null,'',location.pathname+(kind==='content-signer'?'#signing':'#treasury'));
  if(kind==='content-signer'){
    loadSigningIdentities();
    setTimeout(function(){alert('✓ Authorized '+collected+' of '+attempted+' signing key'+(attempted==='1'?'':'s')+' for this identity. It now signs via its HSM-backed KMS key — no held key.');},300);
  }else{
    setTimeout(function(){alert('✓ Collected '+collected+' of '+attempted+' due subscription'+(attempted==='1'?'':'s')+'. The ledger + due list are refreshed.');},300);
  }
  return true;
}
window.addEventListener('hashchange',route);
loadSession();renderPicker();
if(collectCallback()){render().then(function(){showPage('tre');loadSubscriptions();});}
else{connectCallback().then(()=>render()).then(route);}
</script></body></html>`;
