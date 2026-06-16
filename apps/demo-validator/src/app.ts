// The validator Hono app (used by both the local Node server and the Vercel
// handler). Config from env: MCP_URL (for the issuer corpus), trusted issuers,
// and an optional on-chain ERC-1271 verifier.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { validateBundle } from './validate.js';
import { makeOnchainVerifier, makeDelegatedAuthorityVerifier } from './onchain.js';
import { buildValidationAttestation, hashJson, VALIDATOR_AGENT_ID, VALIDATOR_NAME, KMS_SIGNING, KMS_DEBUG } from './attestation.js';
import { buildTrustGraph } from './trust-graph.js';
import { anchorAttestation } from './anchor.js';
import type { EvidenceBundle } from './bundle.js';

const MCP_URL = (process.env.MCP_URL ?? 'http://localhost:8790').replace(/\/$/, '');
// On-chain SA issuers (Base Sepolia) by default; override with VALIDATOR_TRUSTED_ISSUERS.
// Per-edition issuers (spec 266): bsb.impact (0x72D8…) + lbsb.impact (0x91B4…).
// Home-deployment issuer SAs (the demo resolves names in the home registry): bsb.impact → 0xf66c…,
// lbsb.impact → 0x91B4… (was bsb 0x72D8 on the old registry). Override with VALIDATOR_TRUSTED_ISSUERS.
const TRUSTED_ISSUERS = (process.env.VALIDATOR_TRUSTED_ISSUERS ?? '0xf66cd1621D401cF6b2D93Ea53faC7EcB639cdd32,0x91b43817d8f9ff449a4c68cb187821b13b5feabe')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const verifySignature = makeOnchainVerifier();
const verifyDelegatedAuthority = makeDelegatedAuthorityVerifier();

async function fetchCorpus(edition: string): Promise<string[]> {
  const res = await fetch(`${MCP_URL}/corpus/${edition}`);
  const body = (await res.json()) as { ok: boolean; commitments?: string[] };
  if (!body.ok || !body.commitments) throw new Error(`corpus fetch failed for ${edition}`);
  return body.commitments;
}

export const app = new Hono();
app.use('*', cors());

app.get('/health', (c) =>
  c.json({
    ok: true,
    service: 'demo-validator',
    mode: verifySignature ? 'onchain' : 'dev',
    attestationSigner: KMS_SIGNING ? 'kms-delegated (demo-validator.impact, no held key)' : 'dev-held-key',
    kms: KMS_DEBUG,
    trustedIssuers: TRUSTED_ISSUERS,
    mcp: MCP_URL,
    anchorConfigured: { registry: !!process.env.ATTESTATION_REGISTRY, relayer: !!process.env.VALIDATOR_ANCHOR_PK, rpc: !!process.env.VALIDATOR_RPC_URL },
  }),
);

app.get('/', (c) =>
  c.text('demo-validator — POST an agentic-trust evidence bundle to /validate. GET /health for config.'),
);

app.post('/validate', async (c) => {
  const bundle = await c.req.json<EvidenceBundle>().catch(() => null);
  if (!bundle) return c.json({ ok: false, error: 'invalid bundle' }, 400);
  try {
    const result = await validateBundle(bundle, { trustedIssuers: TRUSTED_ISSUERS, fetchCorpus, verifySignature, verifyDelegatedAuthority });

    // The validator is an ATTESTING agent: sign a ValidationAttestation over the
    // bundle + return a small trust graph around the validated output.
    let attestation: unknown;
    let graph: unknown;
    let anchor: unknown;
    if (result.checks.schema?.ok) {
      const profile = `${bundle.policy?.policyProfile ?? 'public-domain-demo'}${bundle.proof?.zkMembership ? '+zk-membership' : ''}`;
      attestation = await buildValidationAttestation({
        subjectAgentId: bundle.agent.agentId,
        subjectName: bundle.agent.agentName,
        agentRunId: bundle.intent.agentRunId,
        outputId: bundle.intent.outputId,
        evidenceBundleHash: hashJson(bundle),
        responseHash: bundle.response.responseHash,
        validationProfile: profile,
        outcome: result.outcome,
        checksHash: hashJson(result.checks),
        issuedAt: new Date().toISOString(),
      });
      const attHash = ((attestation as { proof?: { proofValue?: string } }).proof?.proofValue ?? '').slice(0, 18);
      graph = buildTrustGraph({
        validatorAgentId: VALIDATOR_AGENT_ID,
        validatorName: VALIDATOR_NAME,
        subjectAgentId: bundle.agent.agentId,
        subjectName: bundle.agent.agentName ?? 'scripture-resolver.agent',
        issuer: bundle.content.issuer,
        issuerName: bundle.content.issuerName,
        descriptorId: bundle.content.descriptorId,
        profile,
        outcome: result.outcome,
        attestationHash: attHash,
        agentRunId: bundle.intent.agentRunId,
        outputId: bundle.intent.outputId,
      });

      // Phase 6 — best-effort: anchor the attestation on-chain (timeboxed so a
      // slow RPC can't blow the function budget; validation never fails on it).
      try {
        anchor = await Promise.race([
          anchorAttestation(attestation, { subjectAgentId: bundle.agent.agentId, profile, outcome: result.outcome }),
          new Promise((resolve) => setTimeout(() => resolve({ onchain: false, error: 'anchor timed out' }), 45000)),
        ]);
      } catch (e) {
        anchor = { onchain: false, error: (e as Error).message };
      }
    }
    return c.json({ ok: true, ...result, attestation, graph, anchor });
  } catch (e) {
    return c.json({ ok: false, error: 'validation error', detail: (e as Error).message }, 500);
  }
});

export default app;
