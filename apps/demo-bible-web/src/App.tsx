import { useEffect, useMemo, useState } from 'react';
import { BRANDING, COPY } from './domain';
import {
  fetchEditions,
  fetchBooks,
  resolvePassage,
  issueEntitlement,
  askQuestion,
  validateResponse,
  type Edition,
  type BibleBook,
  type ResolveResult,
  type AskResult,
  type AskCitation,
  type TrustValidation,
} from './api';

function short(hex?: string, n = 6): string {
  if (!hex) return '';
  return hex.length > 2 * n + 2 ? `${hex.slice(0, n + 2)}…${hex.slice(-n)}` : hex;
}

// Fixed layout by node kind (the graph shape is stable: 6 nodes, 5 edges).
const NODE_POS: Record<string, { x: number; y: number }> = {
  consumer: { x: 76, y: 152 },
  validator: { x: 286, y: 56 },
  agent: { x: 286, y: 152 },
  profile: { x: 488, y: 56 },
  descriptor: { x: 286, y: 248 },
  issuer: { x: 488, y: 214 },
};
const NODE_COLOR: Record<string, string> = {
  consumer: '#6b7280',
  validator: '#2563eb',
  agent: '#0e7490',
  issuer: '#9333ea',
  descriptor: '#64748b',
  profile: '#b45309',
};

function TrustGraphSvg({ graph }: { graph: NonNullable<TrustValidation['graph']> }) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const posOf = (id: string) => NODE_POS[byId.get(id)?.kind ?? 'agent'] ?? { x: 286, y: 152 };
  const W = 118;
  const H = 30;
  return (
    <svg viewBox="0 0 564 304" className="tg-svg" role="img" aria-label="trust graph">
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
        const sx = a.x + ux * 32;
        const sy = a.y + uy * 18;
        const ex = b.x - ux * 36;
        const ey = b.y - uy * 20;
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
        const p = NODE_POS[n.kind] ?? { x: 286, y: 152 };
        const color = NODE_COLOR[n.kind] ?? '#475569';
        return (
          <g key={n.id}>
            <rect x={p.x - W / 2} y={p.y - H / 2} width={W} height={H} rx="7" fill="#fff" stroke={color} strokeWidth="1.6" />
            <text x={p.x} y={p.y + 4} className="tg-svg-label" textAnchor="middle" fill={color}>
              {n.label.length > 19 ? n.label.slice(0, 18) + '…' : n.label}
            </text>
          </g>
        );
      })}
    </svg>
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
        <span className="tg-by">attested by <b>{String(cs.validatorName ?? 'demo-validator.agent')}</b></span>
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
      {v.graph && <TrustGraphSvg graph={v.graph} />}
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
