import { useEffect, useMemo, useState } from 'react';
import { BRANDING, COPY } from './domain';
import {
  fetchEditions,
  fetchBooks,
  resolvePassage,
  issueEntitlement,
  askQuestion,
  validateResponse,
  resolveRange,
  type Edition,
  type BibleBook,
  type ResolveResult,
  type AskResult,
  type AskCitation,
  type TrustValidation,
  type RangeResult,
} from './api';

function short(hex?: string, n = 6): string {
  if (!hex) return '';
  return hex.length > 2 * n + 2 ? `${hex.slice(0, n + 2)}…${hex.slice(-n)}` : hex;
}

// Fixed layout by node kind (the graph shape is stable: 6 nodes, 5 edges).
const NODE_POS: Record<string, { x: number; y: number }> = {
  consumer: { x: 92, y: 160 },
  validator: { x: 322, y: 58 },
  agent: { x: 322, y: 160 },
  profile: { x: 552, y: 58 },
  descriptor: { x: 322, y: 262 },
  issuer: { x: 552, y: 226 },
};
const NODE_COLOR: Record<string, string> = {
  consumer: '#6b7280',
  validator: '#2563eb',
  agent: '#0e7490',
  issuer: '#9333ea',
  descriptor: '#64748b',
  profile: '#b45309',
};
const ROLE_SHORT: Record<string, string> = {
  consumer: 'YOU / APP',
  issuer: 'ISSUER',
  agent: 'AGENT',
  validator: 'VALIDATOR',
  descriptor: 'DESCRIPTOR',
  profile: 'PROFILE',
};

function hostOf(url?: string): string {
  if (!url) return '';
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
function addrOf(id: string): string | undefined {
  const tail = id.startsWith('eip155:') ? id.split(':').pop() ?? '' : id;
  return /^0x[0-9a-fA-F]{40}$/.test(tail) ? tail : undefined;
}
function urlForKind(kind: string, services?: TrustValidation['services']): string | undefined {
  if (kind === 'consumer') return typeof window !== 'undefined' ? window.location.origin : undefined;
  if (kind === 'agent') return services?.agent;
  if (kind === 'validator') return services?.validator;
  if (kind === 'issuer') return services?.mcp;
  return undefined;
}

function TrustGraphSvg({ graph }: { graph: NonNullable<TrustValidation['graph']> }) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const posOf = (id: string) => NODE_POS[byId.get(id)?.kind ?? 'agent'] ?? { x: 322, y: 160 };
  const W = 168;
  const H = 46;
  return (
    <svg viewBox="0 0 644 320" className="tg-svg" role="img" aria-label="trust graph">
      <defs>
        <marker id="tg-arrow" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="#9aa6bd" />
        </marker>
      </defs>
      {graph.edges.map((e, i) => {
        const a = posOf(e.from);
        const b = posOf(e.to);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        const sx = a.x + ux * 46;
        const sy = a.y + uy * 26;
        const ex = b.x - ux * 50;
        const ey = b.y - uy * 28;
        return (
          <g key={i}>
            <line x1={sx} y1={sy} x2={ex} y2={ey} stroke="#9aa6bd" strokeWidth="1.5" markerEnd="url(#tg-arrow)" />
            <text x={(sx + ex) / 2} y={(sy + ey) / 2 - 3} className="tg-edge-label" textAnchor="middle">
              {e.rel.replace(/_/g, ' ').toLowerCase()}
            </text>
          </g>
        );
      })}
      {graph.nodes.map((n) => {
        const p = NODE_POS[n.kind] ?? { x: 322, y: 160 };
        const color = NODE_COLOR[n.kind] ?? '#475569';
        const label = n.label.length > 22 ? n.label.slice(0, 21) + '…' : n.label;
        return (
          <g key={n.id}>
            <rect x={p.x - W / 2} y={p.y - H / 2} width={W} height={H} rx="8" fill="#fff" stroke={color} strokeWidth="1.6" />
            <text x={p.x} y={p.y - 6} className="tg-svg-role" textAnchor="middle" fill={color}>
              {ROLE_SHORT[n.kind] ?? n.kind}
            </text>
            <text x={p.x} y={p.y + 12} className="tg-svg-name" textAnchor="middle">
              {label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// A legend tying each node to its on-chain name, app URL, and address.
function TrustGraphLegend({ graph, services }: { graph: NonNullable<TrustValidation['graph']>; services?: TrustValidation['services'] }) {
  return (
    <ul className="tg-legend">
      {graph.nodes.map((n) => {
        const color = NODE_COLOR[n.kind] ?? '#475569';
        const url = urlForKind(n.kind, services);
        const addr = addrOf(n.id);
        return (
          <li key={n.id}>
            <span className="tg-dot" style={{ background: color }} />
            <span className="tg-leg-role">{ROLE_SHORT[n.kind] ?? n.kind}</span>
            <span className="tg-leg-name">{n.label}</span>
            {url && (
              <a className="tg-leg-link" href={url} target="_blank" rel="noreferrer">
                {hostOf(url)} ↗
              </a>
            )}
            {addr && (
              <a className="tg-leg-link mono" href={`https://sepolia.basescan.org/address/${addr}`} target="_blank" rel="noreferrer">
                ⛓ {short(addr, 4)} ↗
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// The trust graph + signed ValidationAttestation from the INDEPENDENT validator.
function TrustGraphCard({ v }: { v: TrustValidation }) {
  const cs = (v.attestation?.credentialSubject ?? {}) as Record<string, unknown>;
  const checks = Object.values(v.checks ?? {});
  const passed = checks.filter((c) => c.ok).length;
  const cls = v.outcome === 'validated' ? 'ok' : v.outcome === 'gated' ? 'gate' : 'no';
  const tx = v.anchor?.onchain ? v.anchor.txHash : undefined;
  return (
    <div className="trustgraph">
      <div className="tg-head">
        <span className={`badge ${cls}`}>{v.outcome ?? 'error'}</span>
        <span className="tg-by">attested by <b>{String(cs.validatorName ?? 'demo-validator.impact')}</b></span>
      </div>
      <dl className="tg-meta">
        <dt>Profile</dt>
        <dd>{String(cs.validationProfile ?? '—')}</dd>
        <dt>Checks</dt>
        <dd>{passed}/{checks.length} passed</dd>
        <dt>Attestation</dt>
        <dd className="mono">{short(v.attestation?.proof?.proofValue, 8)}</dd>
        {v.anchor?.onchain && (
          <>
            <dt>On-chain</dt>
            <dd>
              {tx ? (
                <a href={`https://sepolia.basescan.org/tx/${tx}`} target="_blank" rel="noreferrer">⛓ anchored on Base Sepolia ↗</a>
              ) : (
                <span>⛓ anchored on Base Sepolia</span>
              )}
            </dd>
          </>
        )}
      </dl>
      {v.graph && (
        <>
          <TrustGraphSvg graph={v.graph} />
          <TrustGraphLegend graph={v.graph} services={v.services} />
        </>
      )}
    </div>
  );
}

function CitationCard({ cite }: { cite: AskCitation }) {
  const [v, setV] = useState<TrustValidation | null>(null);
  const [busy, setBusy] = useState(false);
  async function validate() {
    setBusy(true);
    try {
      setV(await validateResponse(cite.reference, cite.edition));
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className="cite">
      <div className="cite-ref">
        <b>{cite.reference}</b>
        <button className="verify-btn" onClick={validate} disabled={busy}>
          {busy ? '…' : v ? (v.outcome === 'validated' ? '✓ validated' : `✗ ${v.outcome}`) : 'Validate'}
        </button>
      </div>
      {v && <TrustGraphCard v={v} />}
    </li>
  );
}

function AskPanel() {
  const [q, setQ] = useState('What does it say about love?');
  const [res, setRes] = useState<AskResult | null>(null);
  const [busy, setBusy] = useState(false);
  async function ask() {
    setBusy(true);
    try {
      setRes(await askQuestion(q));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card ask">
      <h2>Ask — verifiable citations</h2>
      <div className="row">
        <input className="ask-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask a question…" />
        <button onClick={ask} disabled={busy}>{busy ? '…' : 'Ask'}</button>
      </div>
      <p className="hint">Try “love”, “comfort”, “strength”, or “creation”. The agent answers and emits signed citations you can verify.</p>
      {res?.ok && (
        <div className="answer">
          <pre>{res.answer}</pre>
          {res.citations.length > 0 && (
            <ul className="cites">
              {res.citations.map((c) => (
                <CitationCard key={c.descriptorId} cite={c} />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

// Verify a RANGE of verses (verse range or whole chapter) from the full BSB.
function RangePanel() {
  const [q, setQ] = useState('John 3:1-16');
  const [res, setRes] = useState<RangeResult | null>(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      setRes(await resolveRange(q));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card range">
      <h2>Verify a range</h2>
      <div className="row">
        <input className="ask-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. John 3:1-16  ·  Psalms 23  ·  Genesis 1" />
        <button onClick={go} disabled={busy}>{busy ? '…' : 'Verify range'}</button>
      </div>
      <p className="hint">A verse range (John 3:1-16) or a whole chapter (Psalms 23). Each verse proves Merkle membership in the on-chain-anchored corpus root.</p>
      {res?.ok && (
        <div className="range-result">
          <div className="tg-head">
            <span className={`badge ${res.allVerified ? 'ok' : 'no'}`}>{res.verified}/{res.count} verified</span>
            <span className="tg-by">
              {res.range} · root <span className="mono">{short(res.corpusRoot, 8)}</span> · {res.corpusRootSource}
            </span>
          </div>
          <ol className="range-verses">
            {res.verses!.map((v) => (
              <li key={v.canonicalId}>
                <span className={v.included ? 'rv-ok' : 'rv-no'}>{v.included ? '✓' : '✗'}</span>
                <b>{v.osis}</b> {v.text}
              </li>
            ))}
          </ol>
        </div>
      )}
      {res && !res.ok && <p className="hint" style={{ color: 'var(--no)' }}>{res.error}</p>}
    </section>
  );
}

// Tamper test: show a verse range's text editable; edit any verse + validate, and
// the hosted validator rejects it (edited text ≠ the issuer's on-chain commitment).
function TamperPanel() {
  const RANGE = 'John 3:16-18';
  const [verses, setVerses] = useState<{ osis: string; text: string }[] | null>(null);
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, TrustValidation>>({});
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    try {
      const r = await resolveRange(RANGE);
      const vs = (r.verses ?? []).map((v) => ({ osis: v.osis, text: v.text }));
      setVerses(vs);
      setEdited(Object.fromEntries(vs.map((v) => [v.osis, v.text])));
      setResults({});
    } finally {
      setBusy(false);
    }
  }
  async function validateAll() {
    if (!verses) return;
    setBusy(true);
    try {
      const out: Record<string, TrustValidation> = {};
      for (const v of verses) out[v.osis] = await validateResponse(v.osis, 'bsb', edited[v.osis]);
      setResults(out);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card tamper">
      <h2>Tamper test — edit a verse, watch it fail</h2>
      {!verses ? (
        <button onClick={load} disabled={busy}>{busy ? '…' : `Load ${RANGE}`}</button>
      ) : (
        <>
          <p className="hint">Each verse below is the issuer's committed rendering ({RANGE}). Edit any verse, then validate — the hosted validator recomputes the SHA-256 commitment and rejects it, because the edited text no longer matches the hash anchored on-chain.</p>
          <div className="tamper-verses">
            {verses.map((v) => {
              const res = results[v.osis];
              const dirty = (edited[v.osis] ?? '') !== v.text;
              return (
                <div key={v.osis} className="tamper-verse">
                  <div className="tamper-row">
                    <b>{v.osis}</b>
                    {res ? <span className={`badge ${res.outcome === 'validated' ? 'ok' : 'no'}`}>{res.outcome}</span> : dirty ? <span className="tamper-edited">edited ●</span> : <span className="tamper-clean">original</span>}
                  </div>
                  <textarea value={edited[v.osis] ?? ''} onChange={(e) => setEdited({ ...edited, [v.osis]: e.target.value })} rows={2} />
                  {res && res.outcome !== 'validated' && (
                    <div className="verdict no">text ↔ on-chain commitment {res.checks?.commitmentMatchesText?.ok ? '✓' : '✗ MISMATCH'} · issuer descriptor still valid {res.checks?.descriptorSignatureAndInclusion?.ok ? '✓' : '✗'}</div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="row">
            <button onClick={validateAll} disabled={busy}>{busy ? 'validating…' : 'Validate with the validator →'}</button>
            <button onClick={load} disabled={busy}>reset to original</button>
          </div>
        </>
      )}
    </section>
  );
}

export function App() {
  const [editions, setEditions] = useState<Edition[]>([]);
  const [books, setBooks] = useState<BibleBook[]>([]);
  const [edition, setEdition] = useState('bsb');
  const [osis, setOsis] = useState('John');
  const [chapter, setChapter] = useState(3);
  const [verse, setVerse] = useState(16);
  const [result, setResult] = useState<ResolveResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [trust, setTrust] = useState<TrustValidation | null>(null);
  const [validating, setValidating] = useState(false);

  async function validateIndependently() {
    setValidating(true);
    try {
      setTrust(await validateResponse(reference, edition));
    } finally {
      setValidating(false);
    }
  }

  useEffect(() => {
    Promise.all([fetchEditions(), fetchBooks()])
      .then(([e, b]) => {
        setEditions(e);
        setBooks(b);
      })
      .catch((ex) => setErr(String(ex)));
  }, []);

  const book = useMemo(() => books.find((b) => b.osis === osis), [books, osis]);
  const currentEdition = useMemo(() => editions.find((e) => e.edition === edition), [editions, edition]);
  const reference = `${book?.name ?? osis} ${chapter}:${verse}`;

  async function lookup(withEntitlement = false) {
    setLoading(true);
    setErr(null);
    setTrust(null);
    try {
      // Real trust path: the corpus issuer SIGNS an entitlement (EIP-712) — not a
      // client-built, unsigned one. The MCP verifies that signature before the gate.
      const entitlement = withEntitlement ? await issueEntitlement(edition) : undefined;
      const r = await resolvePassage(reference, edition, entitlement);
      setResult(r);
      if (!r.ok && r.error) setErr(r.error);
    } catch (ex) {
      setErr(String(ex));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <header>
        <h1>{BRANDING.name}</h1>
        <p className="tagline">{BRANDING.tagline}</p>
      </header>

      <AskPanel />

      <RangePanel />

      <TamperPanel />

      <section className="picker card">
        <h2>{COPY.pickPassage}</h2>
        <div className="row">
          <label>
            {COPY.edition}
            <select value={edition} onChange={(e) => setEdition(e.target.value)}>
              {editions.map((e) => (
                <option key={e.edition} value={e.edition}>
                  {e.displayName} {e.accessPolicy !== 'public' ? `(${e.accessPolicy})` : ''}
                </option>
              ))}
            </select>
          </label>
          <label>
            {COPY.book}
            <select value={osis} onChange={(e) => setOsis(e.target.value)}>
              {books.map((b) => (
                <option key={b.osis} value={b.osis}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {COPY.chapter}
            <input type="number" min={1} max={book?.chapters ?? 150} value={chapter} onChange={(e) => setChapter(Number(e.target.value))} />
          </label>
          <label>
            {COPY.verse}
            <input type="number" min={1} value={verse} onChange={(e) => setVerse(Number(e.target.value))} />
          </label>
          <button onClick={() => lookup(false)} disabled={loading}>
            {loading ? '…' : COPY.lookup}
          </button>
        </div>
        <p className="hint">Try John 3:16, Psalm 23:1, or Genesis 1:1 (BSB). Switch to the licensed edition to see the gate.</p>
      </section>

      {err && <div className="card error">{err}</div>}

      {result?.ok && (
        <section className="result">
          <div className="card verse">
            <div className="ref">{result.display?.reference ?? reference}</div>
            {result.accessible && result.text ? (
              <blockquote>{result.text}</blockquote>
            ) : (
              <div className="gated">
                <p>{COPY.licensedBlocked}</p>
                <button onClick={() => lookup(true)} disabled={loading}>
                  {COPY.issueEntitlement}
                </button>
              </div>
            )}
            <div className="edition-tag">{currentEdition?.displayName}</div>
          </div>

          <div className="card provenance">
            <h3>{COPY.provenance}</h3>
            <span className={`badge ${result.chosen?.verification?.ok ? 'ok' : 'no'}`}>
              {result.chosen?.verification?.ok ? `✓ ${COPY.verified}` : `✗ ${COPY.notVerified}`}
            </span>
            <dl>
              <dt>Canonical locus id</dt>
              <dd className="mono">{short(result.canonicalReference?.id, 8)}</dd>
              <dt>Issuer</dt>
              <dd>{result.chosen?.issuerName}</dd>
              <dt>OSIS locus</dt>
              <dd className="mono">{result.display?.osis}</dd>
              <dt>Access policy</dt>
              <dd>{result.accessPolicy}</dd>
              <dt>Commitment ({result.chosen?.commitment?.algorithm})</dt>
              <dd className="mono">{short(result.chosen?.commitment?.value, 8)}</dd>
              {result.accessible && (
                <>
                  <dt>Text ↔ commitment</dt>
                  <dd>{result.commitmentVerified ? '✓ matches' : '✗ mismatch'}</dd>
                </>
              )}
            </dl>
            <div className="tg-action">
              <button onClick={validateIndependently} disabled={validating}>
                {validating ? 'validating…' : 'Validate independently →'}
              </button>
              <span className="hint">an independent validator agent checks the evidence + signs an attestation</span>
            </div>
            {trust && <TrustGraphCard v={trust} />}
          </div>

          {result.candidates && result.candidates.length > 0 && (
            <div className="card candidates">
              <h3>Candidates ({result.candidates.length})</h3>
              <ul>
                {result.candidates.map((cand) => (
                  <li key={cand.descriptorId}>
                    <span className={`dot ${cand.admitted ? 'ok' : 'no'}`} />
                    <b>{cand.edition}</b> · {cand.issuerName} · {cand.rightsStatus}
                    {cand.admitted
                      ? cand.verification?.ok
                        ? ' · ✓ verified'
                        : ' · ✗ verify failed'
                      : ` · screened (${cand.reason})`}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <details className="card citation">
            <summary>
              {COPY.citation}
              {(result.citation as { proof?: unknown } | undefined)?.proof ? (
                <span className="badge ok" style={{ marginLeft: 10 }}>✓ agent-signed</span>
              ) : null}
            </summary>
            <pre>{JSON.stringify(result.citation, null, 2)}</pre>
          </details>
        </section>
      )}

      <footer>{BRANDING.footer}</footer>
    </div>
  );
}
