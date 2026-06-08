// Third-party validator service. Independent of the responding agent: POST an
// evidence bundle to /validate and it returns validated / gated / rejected with
// per-check results. It re-derives the issuer's Poseidon corpus root from the
// MCP to verify zk membership proofs.

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { validateBundle } from './validate.js';
import type { EvidenceBundle } from './bundle.js';

const MCP_URL = process.env.MCP_URL ?? 'http://localhost:8790';
// Dev trust profile: the demo's dev issuer EOA (anvil #1). On-chain issuers are
// admitted by resolving issuerName via agent-naming + ERC-1271 (inject a verifier).
const TRUSTED_ISSUERS = (process.env.VALIDATOR_TRUSTED_ISSUERS ?? '0x70997970C51812dc3A010C7d01b50e0d17dc79C8')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

async function fetchCorpus(edition: string): Promise<string[]> {
  const res = await fetch(`${MCP_URL}/corpus/${edition}`);
  const body = (await res.json()) as { ok: boolean; commitments?: string[] };
  if (!body.ok || !body.commitments) throw new Error(`corpus fetch failed for ${edition}`);
  return body.commitments;
}

const app = new Hono();
app.use('*', cors());
app.get('/health', (c) => c.json({ ok: true, service: 'demo-validator', trustedIssuers: TRUSTED_ISSUERS, mcp: MCP_URL }));

app.post('/validate', async (c) => {
  const bundle = await c.req.json<EvidenceBundle>().catch(() => null);
  if (!bundle) return c.json({ ok: false, error: 'invalid bundle' }, 400);
  const result = await validateBundle(bundle, { trustedIssuers: TRUSTED_ISSUERS, fetchCorpus });
  return c.json({ ok: true, ...result });
});

const port = Number(process.env.PORT ?? 8792);
serve({ fetch: app.fetch, port });
console.log(`demo-validator listening on :${port} (mcp ${MCP_URL})`);
