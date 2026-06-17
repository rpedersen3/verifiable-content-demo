// Manifest types + loader for the managed-KMS orchestrator (prototype for the future
// @agenticprimitives ap-kms tool — spec docs/spec-automated-kms-provisioning-deploy.md).
// One declarative file is the single source of truth: which signing identities exist, where each
// runtime reads its KMS config, and how to reach GCP + agent-naming. Adding a KMS-backed app = one
// entry here + `pnpm kms:apply`.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, isAbsolute } from 'node:path';

export interface WireSpec {
  /** Cloudflare: aggregate all identities sharing this secret into ONE name→keyVersion JSON map. */
  keyMapSecret?: string;
  /** Single-key targets (e.g. the validator): the secret holding this identity's cryptoKeyVersion. */
  keySecret?: string;
  /** Secret holding the identity's resolved Smart Agent address. */
  saSecret?: string;
  /** Secret holding the owner-signed delegation leaf (set by the ceremony; propagated if available). */
  leafSecret?: string;
}

export interface Deployment {
  platform: 'cloudflare' | 'vercel';
  /** Cloudflare worker name (and `dir` = the wrangler project dir). */
  worker?: string;
  dir?: string;
  /** Vercel project name. */
  project?: string;
  env: string;
}

export interface IdentityTarget {
  deployment: string;
  wire: WireSpec;
}

export interface Identity {
  name: string;
  /** One signing key, wired into one or more deploy targets (e.g. the validator key ALSO appears in the
   *  MCP's CONTENT_SIGNER_KEYS map for the ceremony / address lookup). */
  targets: IdentityTarget[];
}

export interface NamingConfig {
  /** Env var name holding the RPC URL (kept out of the manifest — it carries an API key). */
  rpcUrlEnv: string;
  chainId: number;
  registry: string;
  universalResolver: string;
}

export interface KmsManifest {
  project: string;
  location: string;
  keyRing: string;
  /** Path to the admin/runtime service-account JSON (used to provision AND written as the runtime secret). */
  runtimeServiceAccountFile: string;
  /** The secret name each runtime expects the SA JSON under (written base64, no echo). */
  saSecretName: string;
  naming: NamingConfig;
  /** Base URL exposing the stored content-signer bindings (POST /tools/list_content_signers) — used by
   *  --verify to compare each agent's live KMS delegate against its stored, owner-authorized delegate. */
  bindingsUrl?: string;
  deployments: Record<string, Deployment>;
  identities: Identity[];
}

const expandHome = (p: string): string => (p.startsWith('~') ? join(homedir(), p.slice(1)) : p);

export function loadManifest(path = 'kms.manifest.json'): KmsManifest {
  const abs = isAbsolute(path) ? path : join(process.cwd(), path);
  const m = JSON.parse(readFileSync(abs, 'utf8')) as KmsManifest;
  // Fail-closed validation: every identity target must point at a declared deployment.
  for (const id of m.identities) {
    for (const t of id.targets) {
      if (!m.deployments[t.deployment]) throw new Error(`identity "${id.name}" → unknown deployment "${t.deployment}"`);
    }
  }
  m.runtimeServiceAccountFile = expandHome(m.runtimeServiceAccountFile);
  return m;
}

/** GCP cryptoKey ids allow [a-zA-Z0-9_-] only; map a dotted identity name → a valid key id. */
export const keyIdFor = (name: string): string => name.replace(/[^a-zA-Z0-9_-]/g, '-');
