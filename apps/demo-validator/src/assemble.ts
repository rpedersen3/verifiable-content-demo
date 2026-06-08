// Agent-side helper: assemble the evidence bundle a responding agent emits, from
// the a2a /resolve response + the issuer corpus + a zk membership proof.

import { keccak256, toBytes } from 'viem';
import { buildPoseidonTree, proveMembership, toField } from '@verifiable-content-demo/zk-membership';
import type { EvidenceBundle } from './bundle.js';

interface ResolveCandidate {
  descriptorId: string;
  edition: string;
  issuer: { address: string; did?: string };
  issuerName?: string;
  accessPolicy: string;
  rightsStatus?: string;
  commitment: { value: string };
  descriptor: EvidenceBundle['content']['descriptor'];
  corpusRef: string;
  corpusRoot: string;
  inclusionProof: string[];
  leafIndex: number;
}
interface ResolveResponse {
  canonicalReference: { id: string; envelope: EvidenceBundle['content']['canonicalEnvelope']; alias?: string };
  display?: { reference?: string };
  candidates: ResolveCandidate[];
  text: string | null;
  citation: unknown;
  accessPolicy: string;
}

export async function assembleBundle(opts: {
  resolve: ResolveResponse;
  edition: string;
  corpusCommitments: string[];
  intentType: string;
  agentId: string;
  agentName?: string;
  agentRunId: string;
  outputId: string;
  withZk: boolean;
}): Promise<EvidenceBundle> {
  const { resolve } = opts;
  const cand = resolve.candidates.find((x) => x.edition === opts.edition) ?? resolve.candidates[0]!;
  const text = resolve.text;
  const responseHash = keccak256(toBytes(text ?? ''));

  let zkMembership: EvidenceBundle['proof']['zkMembership'];
  if (opts.withZk && text != null) {
    const tree = await buildPoseidonTree(opts.corpusCommitments.map((c) => toField(c)));
    const signalHash = toField(responseHash);
    zkMembership = await proveMembership(tree, cand.leafIndex, signalHash);
  }

  return {
    intent: { intentType: opts.intentType, requestedReference: resolve.display?.reference ?? '', requestedEdition: opts.edition, agentRunId: opts.agentRunId, outputId: opts.outputId },
    agent: { agentId: opts.agentId, agentName: opts.agentName },
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
    proof: {
      commitment: cand.descriptor.commitment!,
      commitmentVerified: text != null,
      corpusRef: cand.corpusRef,
      corpusRoot: cand.corpusRoot,
      inclusionProof: cand.inclusionProof,
      leafIndex: cand.leafIndex,
      zkMembership,
    },
    policy: { policyProfile: 'public-domain-demo', policyDecision: text != null ? 'allow' : 'gated', entitlement: null },
    citation: resolve.citation,
    response: { text, responseHash, quotedSpans: text ? [{ start: 0, end: text.length, descriptorId: cand.descriptorId }] : [] },
  };
}
