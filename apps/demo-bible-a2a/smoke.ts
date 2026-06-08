// In-process triad smoke test (run: pnpm exec tsx apps/demo-bible-a2a/smoke.ts).
// Routes the a2a worker's fetch() to the MCP Hono app, proving candidate resolve
// → pick → text → verify → enriched citation, without booting servers.
import a2a from './src/index.js';
import mcp from '../demo-bible-mcp/src/index.js';

const MCP_BASE = 'http://127.0.0.1:8790';
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url.startsWith(MCP_BASE)) return mcp.request(url.slice(MCP_BASE.length), init);
  return realFetch(input, init);
}) as typeof fetch;

const env = { MCP_URL: MCP_BASE };
const post = (path: string, body: unknown) =>
  a2a.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, env);

let failures = 0;
const check = (label: string, cond: boolean, detail?: unknown) => {
  console.log(`${cond ? '✓' : '✗'} ${label}`);
  if (!cond) {
    failures++;
    if (detail !== undefined) console.log('   ', JSON.stringify(detail).slice(0, 300));
  }
};

{
  const body = (await (await a2a.request('/.well-known/agent-card.json', {}, env)).json()) as any;
  check('agent card advertises resolve-scripture-passage', body.skills?.[0]?.id === 'resolve-scripture-passage');
}

let canonicalId = '';
{
  const r = (await (await post('/resolve', { reference: 'John 3:16', edition: 'bsb' })).json()) as any;
  canonicalId = r.canonicalReference?.id;
  check('resolves to a domain-separated canonical locus id', typeof canonicalId === 'string' && canonicalId.startsWith('0x'), r.canonicalReference);
  check('returns CANDIDATES across editions (bsb public + licensed)', Array.isArray(r.candidates) && r.candidates.length === 2, r.candidates?.map((c: any) => c.edition));
  check('chosen bsb candidate is verified (signature + merkle)', r.chosen?.edition === 'bsb' && r.chosen?.verification?.ok === true, r.chosen?.verification);
  check('returns BSB text + commitmentVerified', r.accessible && /For God so loved/.test(r.text) && r.commitmentVerified === true, { accessible: r.accessible });
  check('builds an enriched CitationAssertion (citationKind quote, no text)', r.citation?.credentialSubject?.citationKind === 'quote' && !JSON.stringify(r.citation).includes('loved the world'), r.citation?.credentialSubject);
  check('citation is agent-SIGNED (has an EIP-712 proof)', r.citation?.proof?.type === 'Eip712Signature2026' && typeof r.citation.proof.proofValue === 'string', r.citation?.proof);
  check('licensed candidate is screened out (untrusted/rights) but listed', r.candidates.some((c: any) => c.edition === 'demo-licensed' && c.admitted === false), r.candidates);
}

{
  // OSIS + USFM aliases resolve to the SAME canonical id (alias equivalence).
  const usfm = (await (await post('/resolve', { reference: 'USFM:JHN 3:16', edition: 'bsb' })).json()) as any;
  check('USFM alias resolves to the SAME canonicalId as "John 3:16"', usfm.canonicalReference?.id === canonicalId);
}

{
  const r = (await (await post('/resolve', { reference: 'John 3:16', edition: 'demo-licensed' })).json()) as any;
  check('licensed edition: resolves but text gated (no entitlement)', r.ok && r.accessible === false && r.text === null, { accessible: r.accessible });
}

{
  // An UNSIGNED (hand-built) entitlement must now be REJECTED on the signature check.
  const eds = (await (await a2a.request('/editions', {}, env)).json()) as any;
  const lic = eds.editions.find((e: any) => e.edition === 'demo-licensed');
  const unsigned = {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    type: ['VerifiableCredential', 'Entitlement'],
    issuer: 'eip155:31337:0xi',
    validFrom: '2020-01-01T00:00:00Z',
    credentialSubject: { id: 'urn:scripture:reader', corpusRef: lic.corpusRef, accessPolicy: 'licensed' },
  };
  const r = (await (await post('/resolve', { reference: 'John 3:16', edition: 'demo-licensed', entitlement: unsigned })).json()) as any;
  check('licensed: an UNSIGNED entitlement is rejected (signature gate)', r.ok && r.accessible === false, { accessible: r.accessible });
}

{
  // A properly ISSUER-SIGNED entitlement (from /issue-entitlement) unlocks the gate.
  const issued = (await (await post('/issue-entitlement', { edition: 'demo-licensed' })).json()) as any;
  check('issuer signs an Entitlement VC (has proof)', issued.ok && issued.entitlement?.proof?.type === 'Eip712Signature2026', issued.entitlement?.proof);
  const r = (await (await post('/resolve', { reference: 'John 3:16', edition: 'demo-licensed', entitlement: issued.entitlement })).json()) as any;
  check('licensed: accessible WITH a SIGNED entitlement', r.ok && r.accessible === true && typeof r.text === 'string', { accessible: r.accessible, gate: r.gate });
}

console.log(failures === 0 ? '\nTRIAD v2 SMOKE PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
