#!/usr/bin/env tsx
// Entry for the managed-KMS orchestrator (prototype for @agenticprimitives ap-kms).
//   pnpm kms:apply                 # provision + IAM + derive + resolve SA + REPORT (no secret writes)
//   pnpm kms:apply --write         # also push the runtime secrets to Cloudflare + Vercel (no echo)
//   pnpm kms:apply --dry-run       # print the plan only (no GCP mutations)
//   pnpm kms:apply --verify        # read-only: confirm each agent's live KMS delegate == stored authorization
//   pnpm kms:apply --manifest path/to/kms.manifest.json
import { apply, verify } from './kms/apply.js';

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const opt = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };

const run = flag('verify')
  ? verify({ manifestPath: opt('manifest') }).then((problems) => process.exit(problems === 0 ? 0 : 1))
  : apply({ manifestPath: opt('manifest'), write: flag('write'), dryRun: flag('dry-run') });

run.catch((e) => {
  console.error('FATAL:', (e as Error).message);
  process.exit(1);
});
