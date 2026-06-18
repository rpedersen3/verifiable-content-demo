#!/usr/bin/env tsx
// Managed-KMS orchestration for this demo — now driven by the published @agenticprimitives/ap-kms.
// This repo keeps only the declarative `kms.manifest.json` + the app-side deploy-platform secret writers
// (scripts/kms/secret-writers.ts), which we inject; all orchestration logic lives in the package.
//
//   pnpm kms:apply                 # provision + IAM + derive + resolve SA + REPORT (no secret writes)
//   pnpm kms:apply --write         # also push the runtime secrets to Cloudflare + Vercel (no echo)
//   pnpm kms:apply --dry-run       # print the plan only (no GCP mutations)
//   pnpm kms:apply --verify        # read-only: live KMS delegate == stored owner-authorized delegate
//   pnpm kms:apply --manifest path/to/kms.manifest.json
import { applyKmsManifest, verifyKmsManifest } from '@agenticprimitives/ap-kms';
import { loadManifest, makeNodeDeps } from '@agenticprimitives/ap-kms/node';
import { writeSecret } from './kms/secret-writers.js';

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const opt = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };

const manifest = loadManifest(opt('manifest'));
const deps = makeNodeDeps(manifest, { writeSecret });

const run = flag('verify')
  ? verifyKmsManifest(manifest, deps).then((problems) => process.exit(problems === 0 ? 0 : 1))
  : applyKmsManifest(manifest, deps, { write: flag('write'), dryRun: flag('dry-run') });

run.catch((e) => {
  console.error('FATAL:', (e as Error).message);
  process.exit(1);
});
