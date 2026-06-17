// The independent validator: it does NOT trust the responding agent. It re-derives
// and checks every claim in the evidence bundle and returns validated/gated/rejected.

import { recoverAddress, keccak256, toBytes, type Hex, type Address } from 'viem';
import {
  computeCanonicalId,
  verifyContentDescriptor,
  verifyCommitment,
  type SignatureVerifier,
  type DelegatedAuthorityVerifier,
} from '@agenticprimitives/content-primitives';
import { verifyCredentialStructural } from '@agenticprimitives/verifiable-credentials';
import { poseidonRoot, toField, verifyMembership } from './zk.js';
import type { EvidenceBundle, ValidationResult, CheckResult } from './bundle.js';

export interface ValidateOpts {
  /** Issuer addresses this validator's trust profile admits. */
  trustedIssuers: string[];
  /** Fetch the corpus's 16-leaf zk window (the block containing `leafIndex`) for the Poseidon root —
   *  the SAME ordered commitments the prover built its membership tree from (spec 266 Phase 4). */
  fetchCorpus?: (edition: string, leafIndex: number) => Promise<string[]>;
  /** Signature verifier for descriptor/entitlement (EOA recovery by default;
   *  inject ERC-1271 for on-chain issuers). */
  verifySignature?: SignatureVerifier;
  /** spec 266 — verify the issuer→KMS-key delegation (ERC-1271 on the issuer SA) so a delegate-signed
   *  descriptor is trusted without the issuer's key being held. Omit for non-delegated bundles. */
  verifyDelegatedAuthority?: DelegatedAuthorityVerifier;
}

const addrOf = (agentId: string): string => agentId.split(':').pop() ?? agentId;

const eoaRecover: SignatureVerifier = async ({ signer, hash, signature }) => {
  try {
    return (await recoverAddress({ hash, signature })).toLowerCase() === signer.toLowerCase();
  } catch {
    return false;
  }
};

export async function validateBundle(bundle: EvidenceBundle, opts: ValidateOpts): Promise<ValidationResult> {
  const checks: Record<string, CheckResult> = {};
  const verify = opts.verifySignature ?? eoaRecover;
  const set = (k: string, ok: boolean, detail?: string) => {
    checks[k] = { ok, detail };
  };

  // 1. schema — required sections present.
  const hasShape = !!(bundle.intent && bundle.agent?.agentId && bundle.content?.descriptor && bundle.proof?.commitment && bundle.citation && bundle.response);
  set('schema', hasShape, hasShape ? undefined : 'missing required sections');
  if (!hasShape) return { outcome: 'rejected', checks };

  const { content, proof, response } = bundle;
  const descriptor = content.descriptor;

  // 2. canonical reference — the envelope hashes to the claimed canonicalId.
  let canonicalOk = false;
  try {
    canonicalOk = computeCanonicalId(content.canonicalEnvelope) === content.canonicalId;
  } catch (e) {
    canonicalOk = false;
  }
  set('canonicalReference', canonicalOk, canonicalOk ? undefined : 'canonicalId != hash(envelope)');

  // 3. descriptor matches the canonical reference.
  set('descriptorMatchesReference', descriptor.canonicalId === content.canonicalId);

  // 4. descriptor signature (issuer) + Merkle inclusion against the corpus root.
  const dv = await verifyContentDescriptor(descriptor, {
    verifySignature: verify,
    verifyDelegatedAuthority: opts.verifyDelegatedAuthority,
    corpusRoot: proof.corpusRoot as Hex,
    inclusionProof: proof.inclusionProof as Hex[],
  });
  set('descriptorSignatureAndInclusion', dv.ok, dv.ok ? undefined : dv.reason);

  // 5. issuer admitted by the validator's trust profile.
  const issuerAddr = (descriptor.issuer.address ?? '').toLowerCase();
  const issuerTrusted = opts.trustedIssuers.map((a) => a.toLowerCase()).includes(issuerAddr);
  set('issuerTrusted', issuerTrusted, issuerTrusted ? undefined : `issuer ${issuerAddr} not in trust profile`);

  // 6. returned text matches the descriptor commitment (when text was served).
  if (response.text != null) {
    set('commitmentMatchesText', !!descriptor.commitment && verifyCommitment(response.text, descriptor.commitment));
  } else {
    set('commitmentMatchesText', true, 'no text served (gated)');
  }

  // 7. policy + entitlement.
  let policyOk = false;
  let gated = false;
  if (content.accessPolicy === 'public') {
    policyOk = true;
  } else {
    const ent = bundle.policy.entitlement as Record<string, unknown> | null | undefined;
    if (!ent) {
      policyOk = response.text == null; // gated WITHOUT text is a valid (gated) outcome
      gated = response.text == null;
    } else {
      const er = verifyCredentialStructural(ent as never);
      let entSigner = '';
      if (er.structural && er.expectedDigest && er.proofValue) {
        try {
          entSigner = await recoverAddress({ hash: er.expectedDigest, signature: er.proofValue });
        } catch {
          entSigner = '';
        }
      }
      const scopeOk = (ent as { credentialSubject?: { corpusRef?: string } }).credentialSubject?.corpusRef === proof.corpusRef;
      policyOk = !!entSigner && entSigner.toLowerCase() === issuerAddr && scopeOk;
    }
  }
  set('policy', policyOk, gated ? 'gated: licensed content not served (no entitlement)' : undefined);

  // 8. responding-agent signature over the citation — DELEGATED (spec 266): the agent signs AS its Smart
  //    Agent via the SA's Cloud-KMS delegate key, authorized by an owner-signed ERC-7710 leaf carried as
  //    `proof.delegatingSigner`. Valid iff the recovered signer IS the leaf's delegate, the leaf delegator
  //    is the agent SA (agentId), and the SA authorized the leaf on-chain (ERC-1271, via the SAME
  //    verifyDelegatedAuthority used for the content descriptor). No held-key / EOA fallback.
  const citation = bundle.citation as {
    credentialSubject?: Record<string, unknown>;
    proof?: { delegatingSigner?: { delegatorIssuer?: string; delegateKey?: string; delegationLeaf?: unknown } };
  };
  const cr = verifyCredentialStructural(bundle.citation as never);
  let citationSigner = '';
  if (cr.structural && cr.expectedDigest && cr.proofValue) {
    try {
      citationSigner = await recoverAddress({ hash: cr.expectedDigest, signature: cr.proofValue });
    } catch {
      citationSigner = '';
    }
  }
  const agentAddr = addrOf(bundle.agent.agentId).toLowerCase();
  const cds = citation.proof?.delegatingSigner;
  let citationSigOk = false;
  let citationSigDetail: string | undefined;
  if (!cds?.delegateKey || !cds?.delegatorIssuer) {
    citationSigDetail = 'citation missing delegatingSigner (agent must sign via its SA’s delegated key)';
  } else if (!citationSigner || citationSigner.toLowerCase() !== cds.delegateKey.toLowerCase()) {
    citationSigDetail = 'citation not signed by the delegate key named in delegatingSigner';
  } else if (cds.delegatorIssuer.toLowerCase() !== agentAddr) {
    citationSigDetail = 'delegatingSigner.delegatorIssuer ≠ the responding agent SA';
  } else if (!opts.verifyDelegatedAuthority) {
    citationSigDetail = 'no on-chain authority verifier configured';
  } else {
    citationSigOk = await opts.verifyDelegatedAuthority({
      delegatorIssuer: cds.delegatorIssuer as Address,
      delegateKey: cds.delegateKey as Address,
      delegationLeaf: cds.delegationLeaf,
    });
    if (!citationSigOk) citationSigDetail = 'agent SA did not authorize the citation delegate key (ERC-1271)';
  }
  set('citationSignature', citationSigOk, citationSigOk ? undefined : citationSigDetail);

  // 9. citation BINDS to the response (descriptor, commitment, canonicalId, run/output).
  const cs = citation.credentialSubject ?? {};
  const cCommit = (cs.commitment as { value?: string } | undefined)?.value;
  const bindingOk =
    cs.canonicalId === content.canonicalId &&
    cs.descriptorId === content.descriptorId &&
    cCommit === descriptor.commitment?.value &&
    cs.agentRunId === bundle.intent.agentRunId &&
    cs.outputId === bundle.intent.outputId;
  set('citationBinding', bindingOk, bindingOk ? undefined : 'citation subject does not match the response');

  // 10. response binding — the response hash commits to the served text.
  if (response.text != null) {
    const h = keccak256(toBytes(response.text));
    set('responseBinding', h.toLowerCase() === response.responseHash.toLowerCase(), 'responseHash = keccak(text)');
  } else {
    set('responseBinding', true, 'no text to bind');
  }

  // 11. zk membership (Phase 4) — verify the Groth16 proof against the issuer's
  //     Poseidon root, independently derived from the published corpus commitments.
  if (proof.zkMembership) {
    if (!opts.fetchCorpus) {
      set('zkMembership', false, 'no corpus fetcher configured');
    } else {
      try {
        const commitments = await opts.fetchCorpus(content.edition, Number(proof.leafIndex));
        const root = await poseidonRoot(commitments.map((c) => toField(c)));
        const signalHash = toField(response.responseHash);
        const ok = await verifyMembership(proof.zkMembership, { root, signalHash });
        set('zkMembership', ok, ok ? 'commitment proven in corpus (leaf hidden)' : 'zk proof invalid');
      } catch (e) {
        set('zkMembership', false, `zk verify error: ${(e as Error).message}`);
      }
    }
  }

  // Outcome.
  const CRITICAL = ['schema', 'canonicalReference', 'descriptorMatchesReference', 'descriptorSignatureAndInclusion', 'issuerTrusted', 'commitmentMatchesText', 'citationSignature', 'citationBinding', 'responseBinding'];
  if (proof.zkMembership) CRITICAL.push('zkMembership');
  const criticalFail = CRITICAL.some((k) => checks[k] && !checks[k]!.ok);
  if (criticalFail || !policyOk) return { outcome: 'rejected', checks };
  if (gated) return { outcome: 'gated', checks };
  return { outcome: 'validated', checks };
}
