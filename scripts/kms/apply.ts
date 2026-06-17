// ap-kms (prototype) — manifest-driven KMS orchestration. Once the smart agents are configured, this runs
// every step to get Cloud-KMS signing working for each app: provision the HSM key + per-key IAM, derive +
// verify the EVM address, resolve the agent SA (agent-naming), and (with --write) push the minimal runtime
// secrets to each deploy target (Cloudflare + Vercel) with no echo. Idempotent, fail-closed.
//
// The owner-signed delegation leaf (SA → KMS key) is the ONE human step — produced by the home content-signer
// ceremony. This tool reports per-identity whether it's bound; it never fabricates authorization.
import { AgentNamingClient } from '@agenticprimitives/agent-naming';
import type { Address } from '@agenticprimitives/types';
import { loadManifest, keyIdFor, type KmsManifest, type Identity } from './manifest.js';
import { GcpProvisioner, loadServiceAccount, deriveKeyAddress, type LoadedSA } from './gcp.js';
import { writeCloudflareSecret, writeVercelSecret } from './targets.js';

interface Resolved {
  name: string;
  targets: Identity['targets'];
  keyId: string;
  keyVersionName: string;
  address: `0x${string}`;
  sa: Address | null;
}

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

export async function apply(opts: { manifestPath?: string; write?: boolean; dryRun?: boolean }) {
  const m = loadManifest(opts.manifestPath);
  console.log(`KMS apply — project=${m.project} location=${m.location} keyRing=${m.keyRing} | ${m.identities.length} identities | write=${!!opts.write} dryRun=${!!opts.dryRun}\n`);

  if (opts.dryRun) {
    for (const id of m.identities) console.log(`  plan: ${id.name} → key "${keyIdFor(id.name)}" → ${id.targets.map((t) => `${t.deployment} (${m.deployments[t.deployment]!.platform})`).join(', ')}`);
    return;
  }

  const sa: LoadedSA = loadServiceAccount(m.runtimeServiceAccountFile);
  const prov = new GcpProvisioner(sa, m.location, m.keyRing);
  await prov.init();
  if (await prov.ensureKeyRing()) console.log(`  keyRing created: ${m.keyRing}`);

  // 1–3. Provision + IAM + derive address, per identity.
  const resolved: Resolved[] = [];
  for (const id of m.identities) {
    const keyId = keyIdFor(id.name);
    const { keyVersionName, created } = await prov.ensureSigningKey(keyId);
    const grantedNow = await prov.ensureKeyIam(keyId, sa.client_email);
    const address = await deriveKeyAddress(sa.raw, keyVersionName);
    console.log(`  ✓ ${id.name}: key ${created ? 'created' : 'exists'}${grantedNow ? ' (+IAM)' : ''} → ${address}`);
    resolved.push({ name: id.name, targets: id.targets, keyId, keyVersionName, address, sa: null });
  }

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
