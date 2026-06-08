// A small trust graph around the validated A2A output, for the UI to render.

export interface TrustGraphNode {
  id: string;
  label: string;
  kind: 'consumer' | 'agent' | 'validator' | 'issuer' | 'descriptor' | 'profile';
}
export interface TrustGraphEdge {
  from: string;
  rel: 'TRUSTS_VALIDATOR' | 'TRUSTS_PROFILE' | 'VALIDATED_OUTPUT' | 'CITED_DESCRIPTOR' | 'ISSUED_DESCRIPTOR';
  to: string;
  meta?: Record<string, unknown>;
}
export interface TrustGraphSnapshot {
  nodes: TrustGraphNode[];
  edges: TrustGraphEdge[];
}

export interface TrustGraphInput {
  validatorAgentId: string;
  validatorName: string;
  subjectAgentId: string;
  subjectName: string;
  issuer: string;
  issuerName?: string;
  descriptorId: string;
  profile: string;
  outcome: string;
  attestationHash: string;
  agentRunId: string;
  outputId: string;
  consumer?: string;
}

export function buildTrustGraph(i: TrustGraphInput): TrustGraphSnapshot {
  const consumer = i.consumer ?? 'consumer-demo';
  const issuerLabel = i.issuerName ?? i.issuer;
  const subjectLabel = i.subjectName ?? i.subjectAgentId;
  const validatorLabel = i.validatorName;

  const nodes: TrustGraphNode[] = [
    { id: consumer, label: 'You / app', kind: 'consumer' },
    { id: i.subjectAgentId, label: subjectLabel, kind: 'agent' },
    { id: i.validatorAgentId, label: validatorLabel, kind: 'validator' },
    { id: i.issuer, label: issuerLabel, kind: 'issuer' },
    { id: i.descriptorId, label: i.descriptorId, kind: 'descriptor' },
    { id: `profile:${i.profile}`, label: i.profile, kind: 'profile' },
  ];

  const edges: TrustGraphEdge[] = [
    { from: consumer, rel: 'TRUSTS_VALIDATOR', to: i.validatorAgentId, meta: { profile: i.profile } },
    { from: i.validatorAgentId, rel: 'TRUSTS_PROFILE', to: `profile:${i.profile}` },
    { from: i.validatorAgentId, rel: 'VALIDATED_OUTPUT', to: i.subjectAgentId, meta: { agentRunId: i.agentRunId, outputId: i.outputId, outcome: i.outcome, attestationHash: i.attestationHash } },
    { from: i.subjectAgentId, rel: 'CITED_DESCRIPTOR', to: i.descriptorId },
    { from: i.issuer, rel: 'ISSUED_DESCRIPTOR', to: i.descriptorId },
  ];

  return { nodes, edges };
}
