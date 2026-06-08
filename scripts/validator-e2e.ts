// Agentic-trust e2e against the HOSTED validator: a responding agent (the live
// a2a) resolves + cites; this script generates a Groth16 zk membership proof
// (the local prover) and assembles the evidence bundle; the hosted validator
// (Vercel) independently checks it.
//
//   VALIDATOR_URL=https://<vercel>  pnpm validate:e2e
// Defaults target the live Cloudflare a2a/mcp (on-chain mode, Base Sepolia).

import { keccak256, toBytes } from 'viem';
import { buildPoseidonTree, proveMembership, toField } from '@verifiable-content-demo/zk-membership';

const A2A = process.env.A2A_URL ?? 'https://demo-bible-a2a-production.richardpedersen3.workers.dev';
const MCP = process.env.MCP_URL ?? 'https://demo-bible-mcp-production.richardpedersen3.workers.dev';
const VALIDATOR = process.env.VALIDATOR_URL;

async function jpost(url: string, body: unknown) {
  return (await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json() as Promise<any>;
}

async function buildBundle() {
  const resolve = await jpost(`${A2A}/resolve`, { reference: 'John 3:16', edition: 'bsb', agentRunId: 'run_v_1', outputId: 'answer_1' });
  if (!resolve.ok) throw new Error('resolve failed: ' + JSON.stringify(resolve).slice(0, 200));
  const cand = resolve.candidates.find((x: any) => x.edition === 'bsb') ?? resolve.candidates[0];
  const text: string | null = resolve.text;
  const responseHash = keccak256(toBytes(text ?? ''));

  // Groth16 zk membership proof (leaf hidden), bound to the response hash.
  const corpus = (await (await fetch(`${MCP}/corpus/bsb`)).json()) as { commitments: string[] };
  const tree = await buildPoseidonTree(corpus.commitments.map((c) => toField(c)));
  const zk = await proveMembership(tree, cand.leafIndex, toField(responseHash));

  return {
    intent: { intentType: 'quote', requestedReference: resolve.display?.reference ?? 'John 3:16', requestedEdition: 'bsb', agentRunId: 'run_v_1', outputId: 'answer_1' },
    agent: { agentId: 'eip155:84532:0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC', agentName: 'scripture-resolver.agent' },
    content: {
      canonicalId: resolve.canonicalReference.id,
      canonicalEnvelope: resolve.canonicalReference.envelope,
      scheme: cand.descriptor.contentType,
      displayReference: resolve.display?.reference,
      descriptorId: cand.descriptorId,
      descriptor: cand.descriptor,
      issuer: cand.issuer.address,
      issuerName: cand.issuerName,
      edition: cand.edition,
      accessPolicy: cand.accessPolicy,
      rightsStatus: cand.rightsStatus,
    },
    proof: { commitment: cand.descriptor.commitment, commitmentVerified: text != null, corpusRef: cand.corpusRef, corpusRoot: cand.corpusRoot, inclusionProof: cand.inclusionProof, leafIndex: cand.leafIndex, zkMembership: zk },
    policy: { policyProfile: 'public-domain-demo', policyDecision: text != null ? 'allow' : 'gated', entitlement: null },
    citation: resolve.citation,
    response: { text, responseHash, quotedSpans: text ? [{ start: 0, end: text.length, descriptorId: cand.descriptorId }] : [] },
  };
}

function show(label: string, r: { outcome: string; checks: Record<string, { ok: boolean; detail?: string }> }) {
  console.log(`\n${label}: ${r.outcome?.toUpperCase()}`);
  for (const [k, v] of Object.entries(r.checks ?? {})) console.log(`  ${v.ok ? '✓' : '✗'} ${k}${v.detail ? ` — ${v.detail}` : ''}`);
}

async function main() {
  if (!VALIDATOR) throw new Error('set VALIDATOR_URL to the hosted validator');
  const bundle = await buildBundle();
  console.log('evidence bundle assembled (issuer', bundle.content.issuer + '); zk public signals:', (bundle.proof.zkMembership?.publicSignals ?? []).map((s: string) => s.slice(0, 10) + '…'));

  const ok = await jpost(`${VALIDATOR}/validate`, bundle);
  show('Honest bundle', ok);

  const tampered = JSON.parse(JSON.stringify(bundle));
  tampered.response.text = (tampered.response.text ?? '') + ' (TAMPERED)';
  const bad = await jpost(`${VALIDATOR}/validate`, tampered);
  show('Tampered response', bad);

  const pass = ok.outcome === 'validated' && bad.outcome === 'rejected';
  console.log(`\n${pass ? 'HOSTED VALIDATOR E2E PASSED ✓' : 'HOSTED VALIDATOR E2E FAILED ✗'}`);
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error('e2e error:', e);
  process.exit(1);
});
