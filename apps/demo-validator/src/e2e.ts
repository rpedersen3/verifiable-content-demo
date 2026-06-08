// End-to-end agentic-trust flow: a responding agent (the a2a) produces an
// evidence bundle (+ a zk membership proof); the independent validator checks it.
// Requires the triad running in DEV mode (`pnpm dev`, no .dev.vars) + the zk
// setup done (`pnpm --filter @verifiable-content-demo/zk-membership setup`).

import { assembleBundle } from './assemble.js';
import { validateBundle } from './validate.js';

const A2A = process.env.A2A_URL ?? 'http://localhost:8791';
const MCP = process.env.MCP_URL ?? 'http://localhost:8790';
const DEV_ISSUER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return res.json() as Promise<any>;
}

function show(label: string, r: { outcome: string; checks: Record<string, { ok: boolean; detail?: string }> }) {
  console.log(`\n${label}: ${r.outcome.toUpperCase()}`);
  for (const [k, v] of Object.entries(r.checks)) console.log(`  ${v.ok ? '✓' : '✗'} ${k}${v.detail ? ` — ${v.detail}` : ''}`);
}

async function main() {
  // 1. responding agent resolves + cites John 3:16 (BSB).
  const resolve = await post(`${A2A}/resolve`, { reference: 'John 3:16', edition: 'bsb', agentRunId: 'run_e2e_1', outputId: 'answer_1' });
  if (!resolve.ok) throw new Error('resolve failed: ' + JSON.stringify(resolve).slice(0, 200));

  // 2. fetch the issuer corpus commitments (for the zk Poseidon root).
  const corpus = (await (await fetch(`${MCP}/corpus/bsb`)).json()) as { commitments: string[] };

  // 3. assemble the evidence bundle WITH a Groth16 zk membership proof.
  const bundle = await assembleBundle({
    resolve,
    edition: 'bsb',
    corpusCommitments: corpus.commitments,
    intentType: 'quote',
    agentId: 'eip155:31337:0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
    agentName: 'scripture-resolver.agent',
    agentRunId: 'run_e2e_1',
    outputId: 'answer_1',
    withZk: true,
  });
  console.log('evidence bundle assembled — zk proof public signals:', (bundle.proof.zkMembership?.publicSignals ?? []).map((s) => s.slice(0, 10) + '…'));

  const fetchCorpus = async (edition: string) => ((await (await fetch(`${MCP}/corpus/${edition}`)).json()) as { commitments: string[] }).commitments;

  // 4. independent validation → should be VALIDATED.
  const ok = await validateBundle(bundle, { trustedIssuers: [DEV_ISSUER], fetchCorpus });
  show('Honest bundle', ok);

  // 5. tamper: change the response text. Commitment + response binding + zk
  //    signalHash all break → REJECTED.
  const tampered = JSON.parse(JSON.stringify(bundle));
  tampered.response.text = 'For God so loved the world (TAMPERED) ...';
  const bad = await validateBundle(tampered, { trustedIssuers: [DEV_ISSUER], fetchCorpus });
  show('Tampered response', bad);

  // 6. untrusted issuer profile → REJECTED at issuerTrusted.
  const strict = await validateBundle(bundle, { trustedIssuers: ['0x000000000000000000000000000000000000dEaD'], fetchCorpus });
  show('Untrusted-issuer profile', strict);

  const pass = ok.outcome === 'validated' && bad.outcome === 'rejected' && strict.outcome === 'rejected';
  console.log(`\n${pass ? 'VALIDATOR E2E PASSED ✓' : 'VALIDATOR E2E FAILED ✗'}`);
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error('e2e error:', e);
  process.exit(1);
});
