/**
 * deploy-impact-workers.ts
 *
 * One-shot deploy of impact's OWN backend Workers (apps/impact-mcp + apps/impact-a2a —
 * copies of agenticprimitives demo-mcp/demo-a2a) to Cloudflare. This MIRRORS steps 1-5 of
 * agenticprimitives' scripts/deploy-cloudflare.ts, trimmed to the two Workers (impact's
 * frontend is the Next.js app on Vercel, not a Cloudflare Pages project).
 *
 * Contract addresses are injected as `--var` flags (NOT a bundled file) — the Worker reads
 * them from env (ENTRY_POINT, DELEGATION_MANAGER, …). They come from the published
 * `@agenticprimitives/contracts` deployments, so this script needs no agenticprimitives checkout.
 *
 * Run after:
 *   1. `wrangler login` (one-time)
 *   2. KV namespaces + D1 created and pasted into the wrangler.tomls (already done)
 *   3. Secrets set: `pnpm secrets:impact` (or scripts/set-impact-secrets.sh)
 *
 * Then:
 *   pnpm deploy:impact
 *
 * Order of operations:
 *   1. Pre-flight (wrangler auth; contracts present)
 *   2. Apply D1 migrations to remote impact-mcp (idempotent)
 *   3. Deploy impact-mcp Worker — capture URL
 *   4. Deploy impact-a2a Worker — inject MCP_URL + ALLOWED_ORIGINS + contract vars — capture URL
 *   5. Write impact-cloudflare-urls.json (gitignored deploy state)
 *
 * Override via env:
 *   DEPLOY_NETWORK=base-sepolia              (only base-sepolia is wired today)
 *   IMPACT_ALLOWED_ORIGINS=https://a,https://b   (browser origins cleared for CORS/CSRF)
 *   IMPACT_BROKER_ORIGIN=https://www.impact-agent.me   (custody-gate iss; social sign-in)
 *   IMPACT_A2A_PUBLIC_BASE_DOMAIN=impact-agent.io
 *   DEMO_SSO_AUD=impact                       (must equal the impact home's connect AUD)
 *   A2A_KMS_BACKEND=gcp-kms GCP_KMS_KEY_NAME=projects/…/cryptoKeyVersions/N  (no-held-key signer)
 *   GCP_KMS_ENCRYPT_KEY_NAME=projects/…       (envelope-encrypt key, gcp-kms only)
 *   SKIP_MIGRATIONS=1                          (skip step 2)
 *   CLOUDFLARE_ACCOUNT_ID=…                    (when the OAuth token can't list accounts)
 */

import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// Same import the impact app uses (apps/impact/src/lib/chain.ts) — the published deployment set.
import { CONTRACTS as d } from '@agenticprimitives/contracts/deployments/base-sepolia';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NETWORK = process.env.DEPLOY_NETWORK ?? 'base-sepolia';
const MCP_DIR = join(REPO_ROOT, 'apps', 'impact-mcp');
const A2A_DIR = join(REPO_ROOT, 'apps', 'impact-a2a');
const STATE_PATH = join(REPO_ROOT, 'impact-cloudflare-urls.json');

// Browser origins cleared for CORS/CSRF on impact-a2a (the impact homes that call it).
const ALLOWED_ORIGINS =
  process.env.IMPACT_ALLOWED_ORIGINS ??
  'https://impact-agent.me,https://*.impact-agent.me,https://churchcore.me,https://*.churchcore.me';
// Custody-gate issuer (only matters for Google/YouVersion KMS-custody sign-in). Must be the
// impact home origin whose broker mints the session. Override per deployment.
const BROKER_ORIGIN = process.env.IMPACT_BROKER_ORIGIN ?? 'https://www.impact-agent.me';
const DEMO_SSO_AUD = process.env.DEMO_SSO_AUD ?? 'impact';
const A2A_PUBLIC_BASE_DOMAIN = process.env.IMPACT_A2A_PUBLIC_BASE_DOMAIN ?? 'impact-agent.io';

const TOTAL = 5;
function step(n: number, msg: string): void {
  console.log(`\n[${n}/${TOTAL}] ${msg}`);
}
function fail(msg: string): never {
  console.error(`\nERROR: ${msg}`);
  process.exit(1);
}
function run(cmd: string, cwd = REPO_ROOT): void {
  execSync(cmd, { cwd, stdio: 'inherit' });
}
function runCapture(cmd: string, cwd = REPO_ROOT): string {
  // Inherit stderr so wrangler progress/errors stream; capture stdout to extract the URL.
  return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'] });
}
function buildVarFlags(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([k, v]) => `--var ${k}:${v}`)
    .join(' ');
}
function extractWorkerUrl(out: string): string | null {
  return out.match(/https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+\.workers\.dev/g)?.[0] ?? null;
}

// 1. Pre-flight
step(1, 'Pre-flight checks…');
try {
  execSync('wrangler whoami', { stdio: 'pipe' });
} catch (e: unknown) {
  const stderr = ((e as { stderr?: Buffer })?.stderr ?? '').toString();
  const partialAuth = stderr.includes('Failed to automatically retrieve account IDs');
  if (!partialAuth) fail('not logged into Cloudflare. Run: wrangler login');
  if (!process.env.CLOUDFLARE_ACCOUNT_ID) {
    fail(
      'Cloudflare OAuth token cannot list accounts. Set CLOUDFLARE_ACCOUNT_ID explicitly ' +
        '(dash.cloudflare.com → right sidebar → Account ID), or re-run `wrangler login`.',
    );
  }
  console.log(`  (partial-auth tolerated; CLOUDFLARE_ACCOUNT_ID=${process.env.CLOUDFLARE_ACCOUNT_ID.slice(0, 8)}…)`);
}
console.log(`  network: ${NETWORK}`);
console.log(`  chainId: ${d.chainId}`);
console.log(`  factory: ${d.agentAccountFactory}`);
console.log(`  delegationManager: ${d.delegationManager}`);
if (Number(d.chainId) !== 84532) {
  fail(`deployments chainId ${d.chainId} != 84532 (base-sepolia). This script targets base-sepolia only.`);
}

// 2. D1 migrations (idempotent)
if (process.env.SKIP_MIGRATIONS) {
  step(2, 'Skipping D1 migrations (SKIP_MIGRATIONS set).');
} else {
  step(2, 'Applying D1 migrations to remote impact-mcp…');
  process.env.CI = '1';
  try {
    run('wrangler d1 migrations apply impact-mcp --remote --env production', MCP_DIR);
  } catch {
    fail('D1 migrations failed — confirm the impact-mcp database_id in apps/impact-mcp/wrangler.toml.');
  }
}

// Contract address vars shared by both Workers (mirrors deploy-cloudflare.ts contractVars).
const contractVars: Record<string, string> = {
  ENTRY_POINT: d.entryPoint,
  DELEGATION_MANAGER: d.delegationManager,
  AGENT_ACCOUNT_FACTORY: d.agentAccountFactory,
  TIMESTAMP_ENFORCER: d.timestampEnforcer,
  ALLOWED_TARGETS_ENFORCER: d.allowedTargetsEnforcer,
  ALLOWED_METHODS_ENFORCER: d.allowedMethodsEnforcer,
  VALUE_ENFORCER: d.valueEnforcer,
};
// Optionals — propagated when present so both Workers find them without bundling addresses.
const opt = d as Record<string, string | undefined>;
if (opt.custodyPolicy) contractVars.CUSTODY_POLICY = opt.custodyPolicy;
if (opt.quorumEnforcer) contractVars.QUORUM_ENFORCER = opt.quorumEnforcer;
if (opt.approvedHashRegistry) contractVars.APPROVED_HASH_REGISTRY = opt.approvedHashRegistry;
if (opt.agentNameRegistry) contractVars.AGENT_NAME_REGISTRY = opt.agentNameRegistry;
if (opt.agentNameUniversalResolver) contractVars.AGENT_NAME_UNIVERSAL_RESOLVER = opt.agentNameUniversalResolver;
if (opt.agentProfileResolver) contractVars.PROFILE_RESOLVER = opt.agentProfileResolver;
if (opt.permissionlessSubregistry) contractVars.PERMISSIONLESS_SUBREGISTRY = opt.permissionlessSubregistry;
if (opt.agentRelationship) contractVars.AGENT_RELATIONSHIP = opt.agentRelationship;
if (opt.universalSignatureValidator) contractVars.UNIVERSAL_SIGNATURE_VALIDATOR = opt.universalSignatureValidator;

// 3. Deploy impact-mcp first (impact-a2a's MCP_URL points at it).
step(3, 'Deploying impact-mcp Worker…');
const mcpOut = runCapture(`wrangler deploy --env production ${buildVarFlags(contractVars)}`, MCP_DIR);
process.stdout.write(mcpOut);
const impactMcpUrl = extractWorkerUrl(mcpOut);
if (!impactMcpUrl) fail('failed to extract impact-mcp Worker URL from wrangler output.');
console.log(`  → ${impactMcpUrl}`);

// 4. Deploy impact-a2a with MCP_URL + ALLOWED_ORIGINS + custody/broker vars injected.
step(4, 'Deploying impact-a2a Worker…');
const a2aVars: Record<string, string> = {
  ...contractVars,
  MCP_URL: impactMcpUrl,
  ALLOWED_ORIGINS,
  A2A_PUBLIC_BASE_DOMAIN,
  // Custody gate (Google/YouVersion → KMS SA). A2A_CUSTODY_BRIDGE_SECRET is a SECRET, not a --var.
  BROKER_ISS: BROKER_ORIGIN,
  BROKER_JWKS_URL: `${BROKER_ORIGIN}/jwks`,
  DEMO_SSO_AUD,
};
if (opt.smartAgentPaymaster) {
  a2aVars.PAYMASTER = opt.smartAgentPaymaster;
  console.log(`  using PAYMASTER ${opt.smartAgentPaymaster}`);
}
// PAYMASTER_VERIFYING_SIGNER is already in wrangler.toml [env.production.vars]; override only if set.
if (process.env.PAYMASTER_VERIFYING_SIGNER) {
  a2aVars.PAYMASTER_VERIFYING_SIGNER = process.env.PAYMASTER_VERIFYING_SIGNER;
}
// No-held-key signer path: A2A_KMS_BACKEND=gcp-kms (uses GCP_SERVICE_ACCOUNT_JSON secret + this key).
if (process.env.A2A_KMS_BACKEND === 'gcp-kms') {
  const keyName = process.env.GCP_KMS_KEY_NAME;
  if (!keyName) {
    fail(
      'A2A_KMS_BACKEND=gcp-kms but GCP_KMS_KEY_NAME is not set.\n' +
        '  Format: projects/<P>/locations/<L>/keyRings/<R>/cryptoKeys/<K>/cryptoKeyVersions/<V>',
    );
  }
  a2aVars.A2A_KMS_BACKEND = 'gcp-kms';
  a2aVars.GCP_KMS_KEY_NAME = keyName;
  console.log(`  using A2A_KMS_BACKEND=gcp-kms with signing key ${keyName}`);
  if (process.env.GCP_KMS_ENCRYPT_KEY_NAME) {
    a2aVars.GCP_KMS_ENCRYPT_KEY_NAME = process.env.GCP_KMS_ENCRYPT_KEY_NAME;
    console.log(`  using GCP_KMS_ENCRYPT_KEY_NAME=${process.env.GCP_KMS_ENCRYPT_KEY_NAME}`);
  }
}
console.log(`  BROKER_ISS ${BROKER_ORIGIN} · DEMO_SSO_AUD ${DEMO_SSO_AUD}`);
const a2aOut = runCapture(`wrangler deploy --env production ${buildVarFlags(a2aVars)}`, A2A_DIR);
process.stdout.write(a2aOut);
const impactA2aUrl = extractWorkerUrl(a2aOut);
if (!impactA2aUrl) fail('failed to extract impact-a2a Worker URL from wrangler output.');
console.log(`  → ${impactA2aUrl}`);

// 5. Deploy-state file (gitignored)
step(5, 'Recording deploy state in impact-cloudflare-urls.json…');
const state = {
  network: NETWORK,
  // deployedAt stamped by the shell wrapper (Date.now is fine in tsx, but keep it simple/portable).
  impactMcpUrl,
  impactA2aUrl,
  brokerOrigin: BROKER_ORIGIN,
  allowedOrigins: ALLOWED_ORIGINS,
  contracts: { chainId: d.chainId, entryPoint: d.entryPoint, agentAccountFactory: d.agentAccountFactory },
};
writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n', 'utf8');
console.log(`  → ${STATE_PATH}`);

console.log('\n────────────────────────────────────────────────────────────');
console.log(`impact-mcp   ${impactMcpUrl}`);
console.log(`impact-a2a   ${impactA2aUrl}`);
console.log('────────────────────────────────────────────────────────────');
console.log('impact next.config defaults: IMPACT_A2A_URL / IMPACT_MCP_URL');
console.log(`  ${impactA2aUrl}`);
console.log(`  ${impactMcpUrl}`);
console.log('If those differ from the workers.dev URLs above, set them on the Vercel impact project.');
console.log('Rollback: wrangler deployments list --env production  (per app dir)');
