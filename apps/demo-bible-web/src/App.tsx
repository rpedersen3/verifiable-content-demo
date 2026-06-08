import { useEffect, useMemo, useState } from 'react';
import { BRANDING, COPY } from './domain';
import {
  fetchEditions,
  fetchBooks,
  resolvePassage,
  issueEntitlement,
  askQuestion,
  verifyCitation,
  type Edition,
  type BibleBook,
  type ResolveResult,
  type AskResult,
  type AskCitation,
  type VerifyResult,
} from './api';

function short(hex?: string, n = 6): string {
  if (!hex) return '';
  return hex.length > 2 * n + 2 ? `${hex.slice(0, n + 2)}…${hex.slice(-n)}` : hex;
}

function CitationCard({ cite }: { cite: AskCitation }) {
  const [verdict, setVerdict] = useState<VerifyResult | null>(null);
  const [busy, setBusy] = useState(false);
  async function verify() {
    setBusy(true);
    try {
      setVerdict(await verifyCitation(cite.citation, cite.reference, cite.edition));
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className="cite">
      <div className="cite-ref">
        <b>{cite.reference}</b> <span className="mono">{short((cite.citation as { proof?: { proofValue?: string } })?.proof?.proofValue, 6)}</span>
        <button className="verify-btn" onClick={verify} disabled={busy}>
          {busy ? '…' : verdict ? (verdict.ok ? '✓ verified' : '✗ failed') : 'Verify'}
        </button>
      </div>
      {verdict && (
        <div className={`verdict ${verdict.ok ? 'ok' : 'no'}`}>
          agent signature {verdict.agentSignatureValid ? '✓' : '✗'} · commitment matches source {verdict.commitmentMatchesSource ? '✓' : '✗'}
        </div>
      )}
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
