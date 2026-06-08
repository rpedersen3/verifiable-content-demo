// The validator Hono app (used by both the local Node server and the Vercel
// handler). Config from env: MCP_URL (for the issuer corpus), trusted issuers,
// and an optional on-chain ERC-1271 verifier.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { validateBundle } from './validate.js';
import { makeOnchainVerifier } from './onchain.js';
import type { EvidenceBundle } from './bundle.js';

const MCP_URL = (process.env.MCP_URL ?? 'http://localhost:8790').replace(/\/$/, '');
// On-chain SA issuer (Base Sepolia) by default; override with VALIDATOR_TRUSTED_ISSUERS.
const TRUSTED_ISSUERS = (process.env.VALIDATOR_TRUSTED_ISSUERS ?? '0x72D8679435cF288689e157b1AA1F8648A7746851')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const verifySignature = makeOnchainVerifier();

async function fetchCorpus(edition: string): Promise<string[]> {
  const res = await fetch(`${MCP_URL}/corpus/${edition}`);
  const body = (await res.json()) as { ok: boolean; commitments?: string[] };
  if (!body.ok || !body.commitments) throw new Error(`corpus fetch failed for ${edition}`);
  return body.commitments;
}

export const app = new Hono();
app.use('*', cors());

app.get('/health', (c) =>
  c.json({ ok: true, service: 'demo-validator', mode: verifySignature ? 'onchain' : 'dev', trustedIssuers: TRUSTED_ISSUERS, mcp: MCP_URL }),
);

app.get('/', (c) =>
  c.text('demo-validator — POST an agentic-trust evidence bundle to /validate. GET /health for config.'),
);

app.post('/validate', async (c) => {
  const bundle = await c.req.json<EvidenceBundle>().catch(() => null);
  if (!bundle) return c.json({ ok: false, error: 'invalid bundle' }, 400);
  try {
    const result = await validateBundle(bundle, { trustedIssuers: TRUSTED_ISSUERS, fetchCorpus, verifySignature });
    return c.json({ ok: true, ...result });
  } catch (e) {
    return c.json({ ok: false, error: 'validation error', detail: (e as Error).message }, 500);
  }
});

export default app;
