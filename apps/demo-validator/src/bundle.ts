// The agentic-trust EVIDENCE BUNDLE a responding agent emits and an independent
// validator checks. Compact version of the 8-section "validation envelope".

import type { ContentDescriptor, ContentCommitment, CanonicalLocusEnvelope } from '@agenticprimitives/content-primitives';

export interface EvidenceBundle {
  intent: {
    intentType: string; // quote | reference | summarize | translate | compare | retrieve
    requestedReference: string;
    requestedEdition?: string;
    agentRunId: string;
    outputId: string;
    constraints?: unknown;
  };
  agent: { agentId: string; agentName?: string };
  content: {
    canonicalId: string;
    canonicalEnvelope: CanonicalLocusEnvelope;
    scheme: string;
    displayReference?: string;
    descriptorId: string;
    descriptor: ContentDescriptor;
    issuer: string;
    issuerName?: string;
    edition: string;
    accessPolicy: string;
    rightsStatus?: string;
  };
  proof: {
    commitment: ContentCommitment;
    commitmentVerified: boolean;
    corpusRef: string;
    corpusRoot: string;
    inclusionProof: string[];
    leafIndex: number;
    // Phase 4 — Groth16 zk membership of the commitment in the issuer corpus.
    zkMembership?: { proof: unknown; publicSignals: string[] };
  };
  policy: {
    policyProfile: string;
    policyDecision: string; // allow | deny | gated | partial
    entitlement?: unknown | null;
    entitlementIssuer?: string;
  };
  citation: unknown; // signed CitationAssertion VC
  response: {
    text: string | null;
    responseHash: string;
    quotedSpans?: { start: number; end: number; descriptorId: string }[];
  };
}

export interface CheckResult {
  ok: boolean;
  detail?: string;
}
export interface ValidationResult {
  outcome: 'validated' | 'gated' | 'rejected';
  checks: Record<string, CheckResult>;
}
