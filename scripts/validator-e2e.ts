// Agentic-trust e2e against the HOSTED validator: a responding agent (the live
// a2a) resolves + cites; this script generates a Groth16 zk membership proof
// (the local prover) and assembles the evidence bundle; the hosted validator
// (Vercel) independently checks it.
//
//   VALIDATOR_URL=https://<vercel>  pnpm validate:e2e
// Defaults target the live Cloudflare a2a/mcp (on-chain mode, Base Sepolia).

import { keccak256, toBytes, recoverAddress, createPublicClient, http } from 'viem';
import { verifyCredentialStructural } from '@agenticprimitives/verifiable-credentials';
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

  // Groth16 zk membership (leaf hidden), bound to the response hash. The circuit is depth-4 (16 leaves),
  // so membership is proven within the verse's 16-commitment BLOCK of the published corpus — the same
  // window the validator independently re-derives from the paginated commitments endpoint.
  const ZK_BLOCK = 16;
  const block = Math.floor(cand.leafIndex / ZK_BLOCK) * ZK_BLOCK;
  const win = (await (await fetch(`${MCP}/corpus/${cand.edition}/commitments?offset=${block}&limit=${ZK_BLOCK}`)).json()) as { commitments: string[] };
  const tree = await buildPoseidonTree(win.commitments.map((c) => toField(c)));
  const zk = await proveMembership(tree, cand.leafIndex - block, toField(responseHash));

  return {
    intent: { intentType: 'quote', requestedReference: resolve.display?.reference ?? 'John 3:16', requestedEdition: 'bsb', agentRunId: 'run_v_1', outputId: 'answer_1' },
    // The RESPONDING agent is whoever signed the citation — resolve it from the citation's issuer SA
    // (scripture-resolver.impact), not a hardcoded dev EOA, so citationSignature binds to the real agent.
    agent: { agentId: resolve.citation.issuer, agentName: 'scripture-resolver.impact' },
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
  const ds = (ok.attestation as any)?.proof?.delegatingSigner;
  console.log('\nattestation proof.type:', (ok.attestation as any)?.proof?.type);
  console.log('delegatingSigner:', ds ? JSON.stringify({ delegatorIssuer: ds.delegatorIssuer, delegateKey: ds.delegateKey, leafDelegate: ds.delegationLeaf?.delegate, leafDelegator: ds.delegationLeaf?.delegator }) : '(none — held-key signer)');
  if (process.env.DEBUG_ANCHOR) console.log('DEBUG anchor:', JSON.stringify(ok.anchor));

  // The validator is an attesting agent: verify its SIGNED ValidationAttestation
  // + that the trust graph asserts VALIDATED_OUTPUT.
  let attOk = false;
  let edgeOk = false;
  const att = ok.attestation as any;
  if (att?.proof) {
    const vr = verifyCredentialStructural(att);
    const expected = (String(att.credentialSubject?.validatorAgentId ?? '').split(':').pop() ?? '') as `0x${string}`;
    if (vr.structural && vr.expectedDigest && vr.proofValue) {
      const rpc = process.env.BASE_SEPOLIA_RPC ?? 'https://sepolia.base.org';
      const pub = createPublicClient({ transport: http(rpc) });
      const code = await pub.getCode({ address: expected }).catch(() => undefined);
      if (code && code.length > 2) {
        // Validator Smart Agent → verify the attestation via ERC-1271.
        const abi = [{ type: 'function', name: 'isValidSignature', stateMutability: 'view', inputs: [{ name: 'h', type: 'bytes32' }, { name: 's', type: 'bytes' }], outputs: [{ type: 'bytes4' }] }] as const;
        const r = (await pub.readContract({ address: expected, abi, functionName: 'isValidSignature', args: [vr.expectedDigest, vr.proofValue] }).catch(() => '0x')) as string;
        attOk = r === '0x1626ba7e';
      } else {
        const signer = await recoverAddress({ hash: vr.expectedDigest, signature: vr.proofValue });
        attOk = signer.toLowerCase() === expected.toLowerCase();
      }
    }
    const isSA = (await createPublicClient({ transport: http(process.env.BASE_SEPOLIA_RPC ?? 'https://sepolia.base.org') }).getCode({ address: expected }).catch(() => undefined))?.length ?? 0;
    edgeOk = (ok.graph?.edges ?? []).some((e: any) => e.rel === 'VALIDATED_OUTPUT' && e.to === bundle.agent.agentId);
    console.log(`\nValidationAttestation by ${att.credentialSubject?.validatorName} (${isSA > 2 ? 'Smart Agent / ERC-1271' : 'EOA'}): signature ${attOk ? '✓' : '✗'} | outcome "${att.credentialSubject?.outcome}" | profile "${att.credentialSubject?.validationProfile}"`);
    console.log(`Trust graph: ${(ok.graph?.edges ?? []).length} edges; VALIDATED_OUTPUT ${edgeOk ? '✓' : '✗'}`);
    for (const e of ok.graph?.edges ?? []) console.log(`  ${e.from}  --${e.rel}-->  ${e.to}`);
  }

  // Phase 6 — if the validator anchored the attestation, INDEPENDENTLY confirm
  // it on-chain (ValidationAttestationRegistry.isValid).
  let anchorOk = true;
  const anchor = ok.anchor as any;
  if (anchor?.onchain) {
    const abi = [{ type: 'function', name: 'isValid', stateMutability: 'view', inputs: [{ name: 'h', type: 'bytes32' }], outputs: [{ type: 'bool' }] }] as const;
    const rpc = process.env.BASE_SEPOLIA_RPC ?? 'https://sepolia.base.org';
    const pub = createPublicClient({ transport: http(rpc) });
    anchorOk = (await pub.readContract({ address: anchor.registry, abi, functionName: 'isValid', args: [anchor.attestationHash] })) as boolean;
    console.log(`On-chain anchor: ${anchorOk ? '✓' : '✗'} | ${anchor.alreadyAnchored ? 'already anchored' : 'tx ' + anchor.txHash} | registry ${anchor.registry}`);
  }

  const tampered = JSON.parse(JSON.stringify(bundle));
  tampered.response.text = (tampered.response.text ?? '') + ' (TAMPERED)';
  const bad = await jpost(`${VALIDATOR}/validate`, tampered);
  show('Tampered response', bad);

  const pass = ok.outcome === 'validated' && bad.outcome === 'rejected' && attOk && edgeOk && anchorOk;
  console.log(`\n${pass ? 'HOSTED VALIDATOR E2E PASSED ✓' : 'HOSTED VALIDATOR E2E FAILED ✗'}`);
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error('e2e error:', e);
  process.exit(1);
});
