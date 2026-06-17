// ap-kms (prototype) — manifest-driven KMS orchestration. Once the smart agents are configured, this runs
// every step to get Cloud-KMS signing working for each app: provision the HSM key + per-key IAM (via the
// upstream @agenticprimitives/key-custody/provision-gcp gcloud-free REST executor), derive + verify the EVM
// address, resolve the agent SA (agent-naming), and (with --write) push the minimal runtime secrets to each
// deploy target (Cloudflare + Vercel) with no echo. Idempotent, fail-closed.
//
// The owner-signed delegation leaf (SA → KMS key) is the ONE human step — produced by the home content-signer
// ceremony. This tool reports per-identity whether it's bound; it never fabricates authorization.
import { executeGcpProvision, createGcpRestStepExecutor, keyVersionName, type ProvisionPlan } from '@agenticprimitives/key-custody/provision-gcp';
import { AgentNamingClient } from '@agenticprimitives/agent-naming';
import type { Address } from '@agenticprimitives/types';
import { loadManifest, keyIdFor, type KmsManifest, type Identity } from './manifest.js';
import { loadServiceAccount, deriveKeyAddress, type LoadedSA } from './gcp.js';
import { writeCloudflareSecret, writeVercelSecret } from './targets.js';

interface Resolved {
  name: string;
  targets: Identity['targets'];
  keyVersionName: string;
  address: `0x${string}`;
  sa: Address | null;
}

/** The upstream provisioning plan derived from the manifest + admin SA (dotted identity names ok — B2;
 *  defaults: HSM, asymmetric-signing, per-key roles/cloudkms.signerVerifier — B3). */
const buildPlan = (m: KmsManifest, sa: LoadedSA): ProvisionPlan => ({
  project: sa.project_id,
  location: m.location,
  keyRing: m.keyRing,
  identities: m.identities.map((i) => i.name),
  runtimeServiceAccount: sa.client_email,
});

async function resolveSA(m: KmsManifest, names: string[]): Promise<Map<string, Address | null>> {
  const out = new Map<string, Address | null>();
  const rpcUrl = process.env[m.naming.rpcUrlEnv];
  if (!rpcUrl) {
    console.warn(`! ${m.naming.rpcUrlEnv} not set — skipping name→SA resolution (SA secrets will not be written)`);
    for (const n of names) out.set(n, null);
    return out;
  }
  const naming = new AgentNamingClient({ rpcUrl, chainId: m.naming.chainId, registry: m.naming.registry as Address, universalResolver: m.naming.universalResolver as Address });
  for (const n of names) {
    try { out.set(n, (await naming.resolveName(n)) as Address | null); } catch { out.set(n, null); }
  }
  return out;
}

/** --verify: confirm each agent is still hooked to its own KMS key — the LIVE KMS delegate (derived from
 *  the key's public key) must equal the owner-AUTHORIZED delegate stored in content_signers, and the stored
 *  SA must equal the name's on-chain resolution. Read-only; returns the count of drifted/unbound identities. */
export async function verify(opts: { manifestPath?: string }): Promise<number> {
  const m = loadManifest(opts.manifestPath);
  console.log(`KMS verify — ${m.identities.length} identities\n`);
  const sa = loadServiceAccount(m.runtimeServiceAccountFile);
  const plan = buildPlan(m, sa);

  const stored = new Map<string, { issuer_sa: string; delegate_key: string }>();
  if (m.bindingsUrl) {
    const res = await fetch(`${m.bindingsUrl}/tools/list_content_signers`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const j = (await res.json()) as { rows?: Array<Record<string, string>>; signers?: Array<Record<string, string>> };
    for (const r of j.rows ?? j.signers ?? []) stored.set(r.issuer_name!, { issuer_sa: r.issuer_sa!, delegate_key: r.delegate_key! });
  } else {
    console.warn('! manifest.bindingsUrl not set — cannot compare against stored delegations\n');
  }
  const saByName = await resolveSA(m, m.identities.map((i) => i.name));

  let problems = 0;
  for (const id of m.identities) {
    // Read-only: the key version is deterministic; deriveKeyAddress returns null if the key is absent.
    const live = await deriveKeyAddress(sa.raw, keyVersionName(plan, keyIdFor(id.name)));
    const resolvedSA = saByName.get(id.name) ?? null;
    const b = stored.get(id.name);
    const issues: string[] = [];
    if (!live) issues.push('KMS key missing / not ENABLED');
    if (!b) issues.push('no stored delegation (ceremony not run)');
    else {
      if (live && b.delegate_key.toLowerCase() !== live.toLowerCase()) issues.push(`stored delegate ${b.delegate_key} ≠ live KMS ${live}`);
      if (resolvedSA && b.issuer_sa.toLowerCase() !== resolvedSA.toLowerCase()) issues.push(`stored SA ${b.issuer_sa} ≠ resolved SA ${resolvedSA}`);
    }
    if (issues.length) problems++;
    console.log(`  ${issues.length ? '✗' : '✓'} ${id.name.padEnd(26)} live=${live ?? '-'} SA=${resolvedSA ?? '(unresolved)'}${issues.length ? ' — ' + issues.join('; ') : ' bound'}`);
  }
  console.log(problems === 0 ? '\n✓ all identities bound — live KMS delegate === owner-authorized delegate' : `\n✗ ${problems} identity/identities drifted or unbound`);
  return problems;
}

export async function apply(opts: { manifestPath?: string; write?: boolean; dryRun?: boolean }) {
  const m = loadManifest(opts.manifestPath);
  console.log(`KMS apply — project=${m.project} location=${m.location} keyRing=${m.keyRing} | ${m.identities.length} identities | write=${!!opts.write} dryRun=${!!opts.dryRun}\n`);

  if (opts.dryRun) {
    for (const id of m.identities) console.log(`  plan: ${id.name} → key "${keyIdFor(id.name)}" → ${id.targets.map((t) => `${t.deployment} (${m.deployments[t.deployment]!.platform})`).join(', ')}`);
    return;
  }

  const sa: LoadedSA = loadServiceAccount(m.runtimeServiceAccountFile);

  // 1–3. Provision keyring + per-identity HSM keys + per-key IAM, and derive each EVM address — all via the
  // upstream gcloud-free REST executor (idempotent). keyMap/addresses are keyed by the ORIGINAL dotted name.
  const plan = buildPlan(m, sa);
  const result = await executeGcpProvision(plan, createGcpRestStepExecutor({ serviceAccountJson: sa.raw }));
  const resolved: Resolved[] = m.identities.map((id) => ({
    name: id.name,
    targets: id.targets,
    keyVersionName: result.keyMap[id.name]!,
    address: result.addresses[id.name]!,
    sa: null,
  }));
  for (const r of resolved) console.log(`  ✓ ${r.name.padEnd(26)} → ${r.address}`);
  console.log(`  (provisioned ${m.identities.length} keys; ${result.alreadyExisted.length} step(s) already existed, ${result.granted.length} IAM grant(s))`);

  // 4. Resolve agent SAs.
  const saByName = await resolveSA(m, resolved.map((r) => r.name));
  for (const r of resolved) r.sa = saByName.get(r.name) ?? null;

  // 5. Wire secrets per deployment (only with --write).
  const saValue = JSON.stringify(JSON.parse(sa.raw)); // canonical single-line JSON (both parsers accept it)
  for (const [depName, dep] of Object.entries(m.deployments)) {
    // Every (identity, wire) pair whose target is THIS deployment.
    const here = resolved.flatMap((r) => r.targets.filter((t) => t.deployment === depName).map((t) => ({ r, wire: t.wire })));
    if (here.length === 0) continue;
    const writes: Array<{ name: string; value: string; note?: string }> = [{ name: m.saSecretName, value: saValue, note: 'SA JSON' }];

    // Cloudflare: aggregate every identity sharing a keyMapSecret into one name→keyVersion map.
    const keyMapSecret = here.find((h) => h.wire.keyMapSecret)?.wire.keyMapSecret;
    if (keyMapSecret) {
      const map = Object.fromEntries(here.filter((h) => h.wire.keyMapSecret === keyMapSecret).map((h) => [h.r.name, h.r.keyVersionName]));
      writes.push({ name: keyMapSecret, value: JSON.stringify(map), note: `${Object.keys(map).length} keys` });
    }
    // Single-key targets (validator): per identity key path + resolved SA.
    for (const h of here) {
      if (h.wire.keySecret) writes.push({ name: h.wire.keySecret, value: h.r.keyVersionName });
      if (h.wire.saSecret && h.r.sa) writes.push({ name: h.wire.saSecret, value: h.r.sa });
      if (h.wire.saSecret && !h.r.sa) console.warn(`  ! ${h.r.name}: SA unresolved → cannot wire ${h.wire.saSecret}`);
    }

    console.log(`\n  ${depName} (${dep.platform}): ${writes.map((w) => w.name + (w.note ? ` [${w.note}]` : '')).join(', ')}`);
    if (!opts.write) { console.log('    (dry — pass --write to push these secrets)'); continue; }
    for (const w of writes) {
      if (dep.platform === 'cloudflare') await writeCloudflareSecret(dep.dir!, dep.env, w.name, w.value);
      else await writeVercelSecret(dep.project!, dep.env, w.name, w.value);
      console.log(`    ✓ wrote ${w.name}`);
    }
  }

  // 6. Report the ceremony gap (the one human step).
  const pendingLeaf = resolved.flatMap((r) => r.targets.filter((t) => t.wire.leafSecret).map((t) => ({ r, leafSecret: t.wire.leafSecret! })));
  if (pendingLeaf.length) {
    console.log(`\n  ⚠ delegation leaf (owner-signed SA→key) is the ceremony step — NOT written by this tool:`);
    for (const { r, leafSecret } of pendingLeaf) console.log(`    - ${r.name}: authorize ${r.address} for SA ${r.sa ?? '(unresolved)'} via the content-signer ceremony, then set ${leafSecret}`);
  }
  console.log('\nDone.');
}
