import { useEffect, useMemo, useState } from 'react';
import { BRANDING, COPY } from './domain';
import {
  fetchEditions,
  fetchBooks,
  resolvePassage,
  issueEntitlement,
  type Edition,
  type BibleBook,
  type ResolveResult,
} from './api';

function short(hex?: string, n = 6): string {
  if (!hex) return '';
  return hex.length > 2 * n + 2 ? `${hex.slice(0, n + 2)}…${hex.slice(-n)}` : hex;
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
