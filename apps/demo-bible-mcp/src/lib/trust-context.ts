// TrustContext — the issuer + signing + verification strategy, resolved per
// request from the Worker env. Two modes:
//
//   dev     — issuer is a fixed EOA; sign raw; verify via EOA recovery.
//   onchain — issuer is a Smart Agent resolved BY NAME via agent-naming;
//             sign EIP-191 (signMessage raw); verify via the SA's ERC-1271
//             isValidSignature (an eth_call to RPC_URL).
//
// Set on-chain mode through env (e.g. apps/demo-bible-mcp/.dev.vars, written by
// scripts/bootstrap-onchain.ts): TRUST_MODE=onchain + RPC_URL / FACTORY /
// REGISTRY / UNIVERSAL_RESOLVER / CHAIN_ID / ISSUER_NAME / ISSUER_SA /
// ISSUER_OWNER_PK.

import { privateKeyToAccount } from 'viem/accounts';
import { recoverAddress, createPublicClient, http, type Hex } from 'viem';
import { toBytes } from 'viem';
import type { Address } from '@agenticprimitives/types';
import type { SignatureVerifier, DelegatedAuthorityVerifier, DelegatingSigner } from '@agenticprimitives/content-primitives';
import { kmsCredentialSigner, type CredentialSigner } from '@agenticprimitives/verifiable-credentials';
import { AgentAccountClient } from '@agenticprimitives/agent-account';
import { AgentNamingClient } from '@agenticprimitives/agent-naming';
import { GcpKmsSigner } from '@agenticprimitives/key-custody';
import { resolveDelegatedSigner } from '@agenticprimitives/delegated-signer';
import { hashDelegation, type Delegation } from '@agenticprimitives/delegation';
import { issuerAccount, DEV_ISSUER, EDITIONS, type EditionEntry, type CorpusSigner } from '../editions/registry.js';

export interface McpEnv {
  TRUST_MODE?: string;
  RPC_URL?: string;
  FACTORY?: string;
  ENTRY_POINT?: string;
  REGISTRY?: string;
  UNIVERSAL_RESOLVER?: string;
  CHAIN_ID?: string;
  ISSUER_NAME?: string;
  ISSUER_SA?: string;
  ISSUER_OWNER_PK?: string;
  CONTENT_REGISTRY?: string;
  // Delegated mode (per-edition issuer + Cloud KMS, no held key):
  DELEGATION_MANAGER?: string;
  GCP_SERVICE_ACCOUNT_JSON?: string;
  /** JSON map: issuerName → Cloud KMS cryptoKeyVersion resource name. */
  CONTENT_SIGNER_KEYS?: string;
  DB?: D1Database;
}

const CONTENT_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'getCorpus',
    stateMutability: 'view',
    inputs: [{ name: 'corpusRef', type: 'bytes32' }],
    outputs: [
      { name: 'issuer', type: 'address' },
      { name: 'corpusRoot', type: 'bytes32' },
      { name: 'manifestHash', type: 'bytes32' },
      { name: 'anchoredAt', type: 'uint64' },
    ],
  },
] as const;

export interface TrustContext {
  mode: 'dev' | 'onchain' | 'delegated';
  issuer: Address;
  /** agent-naming name the issuer was resolved from (onchain only). */
  issuerName?: string;
  /** Sign a 32-byte digest the way this mode's verifier expects. */
  signDigest: (hash: Hex) => Promise<Hex>;
  /** Verify a signature over a digest by `signer` (descriptors + credentials). */
  verifySignature: SignatureVerifier;
  /** Issuers admitted by the demo trust profile. */
  trustedIssuers: Address[];
  /** Credential signer for issuing Entitlement VCs (primary issuer; per-edition below). */
  credentialSigner: CredentialSigner;
  /** Read a corpus's Merkle root from the on-chain ContentCorpusRegistry
   *  (Phase 3). undefined in dev mode → use the off-chain manifest root. */
  corpusRootReader?: (corpusRef: Hex) => Promise<Hex | null>;
  /** Cache key for getCorpora (mode-scoped). */
  cacheKey: string;
  /** The signer for a given edition — dev/on-chain return the single signer; DELEGATED returns the
   *  edition's own issuer SA + its Cloud-KMS delegate signer + the issuer→delegate authorization leaf. */
  signerForEdition: (entry: EditionEntry) => CorpusSigner;
  /** Verifies an issuer→delegate authorization leaf (DELEGATED mode only); wired into descriptor + VC
   *  verification so a verifier roots trust in the issuer SA while the day-to-day signer is the KMS key. */
  verifyDelegatedAuthority?: DelegatedAuthorityVerifier;
  /** Per-edition credential signer (+ delegating-signer metadata) for issuing Entitlement VCs as the
   *  edition's own issuer (e.g. lbsb grants signed under lbsb.impact). */
  credentialSignerForEdition: (edition: string) => { signer: CredentialSigner; delegatingSigner?: DelegatingSigner };
}

const DEV_CHAIN_ID = 31337;

function buildDev(): TrustContext {
  const signDigest = (hash: Hex) => issuerAccount.sign({ hash });
  const credentialSigner: CredentialSigner = { issuerAddress: DEV_ISSUER, chainId: DEV_CHAIN_ID, verifyingContract: DEV_ISSUER, signDigest };
  const single: CorpusSigner = { issuer: DEV_ISSUER, signDigest };
  return {
    mode: 'dev',
    issuer: DEV_ISSUER,
    signDigest,
    verifySignature: async ({ signer, hash, signature }) => {
      try {
        return (await recoverAddress({ hash, signature })).toLowerCase() === signer.toLowerCase();
      } catch {
        return false;
      }
    },
    trustedIssuers: [DEV_ISSUER],
    credentialSigner,
    cacheKey: `dev:${DEV_ISSUER.toLowerCase()}`,
    signerForEdition: () => single,
    credentialSignerForEdition: () => ({ signer: credentialSigner }),
  };
}

async function buildOnchain(env: McpEnv): Promise<TrustContext> {
  const need = (k: keyof McpEnv) => {
    const v = env[k];
    if (!v) throw new Error(`TRUST_MODE=onchain requires env ${k}`);
    return v as string;
  };
  const rpcUrl = need('RPC_URL');
  const chainId = Number(env.CHAIN_ID ?? DEV_CHAIN_ID);
  const owner = privateKeyToAccount(need('ISSUER_OWNER_PK') as Hex);
  const aac = new AgentAccountClient({ rpcUrl, factory: need('FACTORY') as Address, entryPoint: need('ENTRY_POINT') as Address, chainId });

  // Resolve the issuer SA BY NAME (agent-naming) and confirm the binding.
  const naming = new AgentNamingClient({ rpcUrl, chainId, registry: need('REGISTRY') as Address, universalResolver: need('UNIVERSAL_RESOLVER') as Address });
  const issuerName = need('ISSUER_NAME');
  const resolved = await naming.resolveName(issuerName);
  if (!resolved) throw new Error(`agent-naming could not resolve ${issuerName}`);
  if (env.ISSUER_SA && resolved.toLowerCase() !== env.ISSUER_SA.toLowerCase()) {
    throw new Error(`${issuerName} resolves to ${resolved}, not the expected ISSUER_SA ${env.ISSUER_SA}`);
  }
  const issuer = resolved as Address;
  const signDigest = (hash: Hex) => owner.signMessage({ message: { raw: hash } });

  // Phase 3: read corpus roots from the on-chain ContentCorpusRegistry.
  let corpusRootReader: TrustContext['corpusRootReader'];
  if (env.CONTENT_REGISTRY) {
    const pub = createPublicClient({ transport: http(rpcUrl) });
    const registryAddr = env.CONTENT_REGISTRY as Address;
    corpusRootReader = async (corpusRef: Hex) => {
      const r = (await pub.readContract({ address: registryAddr, abi: CONTENT_REGISTRY_ABI, functionName: 'getCorpus', args: [corpusRef] })) as readonly [Address, Hex, Hex, bigint];
      const ZERO = ('0x' + '00'.repeat(32)) as Hex;
      return r[1] !== ZERO ? r[1] : null; // null = not anchored
    };
  }

  const credentialSigner: CredentialSigner = { issuerAddress: issuer, chainId, verifyingContract: issuer, signDigest };
  const single: CorpusSigner = { issuer, signDigest };
  return {
    mode: 'onchain',
    issuer,
    issuerName,
    signDigest,
    verifySignature: ({ signer, hash, signature }) => aac.isValidSignature(signer, hash, signature),
    trustedIssuers: [issuer],
    credentialSigner,
    corpusRootReader,
    cacheKey: `onchain:${issuer.toLowerCase()}`,
    signerForEdition: () => single,
    credentialSignerForEdition: () => ({ signer: credentialSigner }),
  };
}

/**
 * DELEGATED mode (the architecturally-correct path): per-edition issuer SAs, signed by issuer-AUTHORIZED
 * Cloud KMS keys — NO held private key. Each issuer (bsb.impact, lbsb.impact) authorizes its KMS key once
 * via a delegation the owner signs in demo-corpus (stored in D1 `content_signers`). Descriptors + grants
 * carry that leaf; verifiers root trust in the issuer SA via ERC-1271 while the day-to-day signer is the
 * (rotatable, revocable) KMS key. lbsb descriptors are thus signed under lbsb.impact, not bsb.impact.
 */
async function buildDelegated(env: McpEnv): Promise<TrustContext> {
  const need = (k: keyof McpEnv) => { const v = env[k]; if (!v) throw new Error(`TRUST_MODE=delegated requires env ${k}`); return v as string; };
  const rpcUrl = need('RPC_URL');
  const chainId = Number(env.CHAIN_ID ?? DEV_CHAIN_ID);
  const delegationManager = need('DELEGATION_MANAGER') as Address;
  const saJson = need('GCP_SERVICE_ACCOUNT_JSON');
  const keys = JSON.parse(need('CONTENT_SIGNER_KEYS')) as Record<string, string>; // issuerName → KMS key version name
  const aac = new AgentAccountClient({ rpcUrl, factory: need('FACTORY') as Address, entryPoint: need('ENTRY_POINT') as Address, chainId });
  const naming = new AgentNamingClient({ rpcUrl, chainId, registry: need('REGISTRY') as Address, universalResolver: need('UNIVERSAL_RESOLVER') as Address });

  // Universal verifier: a delegate signs as an EOA (ecrecover); an issuer/owner signs as an SA (ERC-1271).
  const verifySignature: SignatureVerifier = async ({ signer, hash, signature }) => {
    try { if ((await recoverAddress({ hash, signature })).toLowerCase() === signer.toLowerCase()) return true; } catch { /* not an EOA sig */ }
    try { return await aac.isValidSignature(signer, hash, signature); } catch { return false; }
  };

  // Resolve, per DISTINCT issuerName: its SA + KMS signer (delegate key) + the owner-signed leaf (from D1).
  // RESILIENT: an issuer that isn't fully configured (no key / unresolved name / no stored delegation) is
  // SKIPPED + surfaced — it must NOT crash the whole MCP. A placeholder edition (e.g. demo-licensed.impact,
  // never provisioned) would otherwise take down every content endpoint on the flip to delegated mode.
  // Editions whose issuer is skipped fail per-request only; configured issuers (bsb.impact, lbsb.impact) work.
  const issuerNames = Array.from(new Set(EDITIONS.map((e) => e.issuerName)));
  type Resolved = { issuerSa: Address; delegateKey: Address; kms: GcpKmsSigner; signDigest: (h: Hex) => Promise<Hex>; leaf: unknown };
  const byIssuer = new Map<string, Resolved>();
  const skippedIssuers: Array<{ issuerName: string; reason: string }> = [];
  for (const issuerName of issuerNames) {
    const keyName = keys[issuerName];
    if (!keyName) { skippedIssuers.push({ issuerName, reason: 'no key in CONTENT_SIGNER_KEYS' }); continue; }
    const row = env.DB
      ? await env.DB.prepare('SELECT delegation_leaf FROM content_signers WHERE issuer_name=?').bind(issuerName).first<{ delegation_leaf: string }>()
      : null;
    if (!row) { skippedIssuers.push({ issuerName, reason: 'no content-signer delegation stored (run the demo-corpus "Authorize content signing" ceremony)' }); continue; }
    try {
      // spec 276 §7 — the bespoke "resolve name → SA, derive KMS address, match stored delegate" orchestration
      // is replaced by the shared delegated-signer primitive: it resolves the issuer name → SA, confirms the SA
      // is deployed, validates the (single-leaf, ROOT) delegation chain, and confirms the leaf delegates to THIS
      // KMS key. Throws → skip + surface, preserving the per-issuer fail-closed resilience.
      const kms = new GcpKmsSigner({ cryptoKeyVersionName: keyName, serviceAccountJson: saJson });
      const leaf = JSON.parse(row.delegation_leaf) as Delegation;
      const resolved = await resolveDelegatedSigner({
        name: issuerName,
        signer: kms,
        delegationChain: [leaf],
        resolveName: (n) => naming.resolveName(n) as Promise<Address | null>,
        verifyAccount: (sa) => aac.isDeployed(sa),
        chainId,
        delegationManager,
      });
      byIssuer.set(issuerName, {
        issuerSa: resolved.delegatorAgent,
        delegateKey: resolved.signerAddress,
        kms,
        signDigest: (hash: Hex) => resolved.sign(toBytes(hash)),
        leaf,
      });
    } catch (e) {
      skippedIssuers.push({ issuerName, reason: (e as Error).message });
    }
  }
  // Surface dropped issuers — never hide them (data-integrity rule). They degrade per-edition, not globally.
  if (skippedIssuers.length) console.warn('[trust:delegated] issuers without a usable content signer:', JSON.stringify(skippedIssuers));
  if (byIssuer.size === 0) throw new Error(`TRUST_MODE=delegated: no issuer is fully configured (${skippedIssuers.map((s) => `${s.issuerName}: ${s.reason}`).join('; ')})`);
  const issuerOf = (entry: EditionEntry): Resolved => {
    const d = byIssuer.get(entry.issuerName);
    if (!d) throw new Error(`edition "${entry.edition}" is unavailable in delegated mode: issuer ${entry.issuerName} has no configured content signer`);
    return d;
  };

  const verifyDelegatedAuthority: DelegatedAuthorityVerifier = async ({ delegatorIssuer, delegateKey, delegationLeaf }) => {
    try {
      const leaf = delegationLeaf as { delegator?: string; delegate?: string; signature?: Hex };
      if (!leaf?.delegator || !leaf?.delegate || !leaf?.signature) return false;
      if (leaf.delegator.toLowerCase() !== delegatorIssuer.toLowerCase()) return false;
      if (leaf.delegate.toLowerCase() !== delegateKey.toLowerCase()) return false;
      const leafHash = hashDelegation(leaf as Parameters<typeof hashDelegation>[0], chainId, delegationManager);
      return await aac.isValidSignature(delegatorIssuer, leafHash, leaf.signature);
    } catch { return false; }
  };

  const signerForEdition = (entry: EditionEntry): CorpusSigner => {
    const d = issuerOf(entry);
    return { issuer: d.issuerSa, signDigest: d.signDigest, delegatingSigner: { delegatorIssuer: d.issuerSa, delegateKey: d.delegateKey, delegationLeaf: d.leaf } };
  };
  const credentialSignerForEdition = (edition: string) => {
    const entry = EDITIONS.find((e) => e.edition === edition) ?? EDITIONS[0]!;
    const d = issuerOf(entry);
    return {
      signer: kmsCredentialSigner({ backend: d.kms, issuerAddress: d.issuerSa, chainId, verifyingContract: d.issuerSa }),
      delegatingSigner: { delegatorIssuer: d.issuerSa, delegateKey: d.delegateKey, delegationLeaf: d.leaf },
    };
  };

  let corpusRootReader: TrustContext['corpusRootReader'];
  if (env.CONTENT_REGISTRY) {
    const pub = createPublicClient({ transport: http(rpcUrl) });
    const registryAddr = env.CONTENT_REGISTRY as Address;
    corpusRootReader = async (corpusRef: Hex) => {
      const r = (await pub.readContract({ address: registryAddr, abi: CONTENT_REGISTRY_ABI, functionName: 'getCorpus', args: [corpusRef] })) as readonly [Address, Hex, Hex, bigint];
      const ZERO = ('0x' + '00'.repeat(32)) as Hex;
      return r[1] !== ZERO ? r[1] : null;
    };
  }

  // Primary = the first edition whose issuer IS configured (not blindly EDITIONS[0], which could be skipped).
  const primaryEntry = EDITIONS.find((e) => byIssuer.has(e.issuerName)) ?? EDITIONS[0]!;
  const primary = issuerOf(primaryEntry);
  return {
    mode: 'delegated',
    issuer: primary.issuerSa,
    issuerName: primaryEntry.issuerName,
    signDigest: primary.signDigest,
    verifySignature,
    trustedIssuers: Array.from(byIssuer.values()).map((d) => d.issuerSa),
    credentialSigner: credentialSignerForEdition(primaryEntry.edition).signer,
    corpusRootReader,
    cacheKey: `delegated:${Array.from(byIssuer.keys()).join(',')}`,
    signerForEdition,
    verifyDelegatedAuthority,
    credentialSignerForEdition,
  };
}

/** Derive the per-identity Cloud-KMS signing-key ADDRESSES (no signing, no held key) so the demo-corpus
 *  ceremony knows which key each signing identity must authorize. Returns name + SA + KMS key address per
 *  DISTINCT signer. The signer set is the UNION of edition issuers (bsb.impact, lbsb.impact) AND every other
 *  name configured in CONTENT_SIGNER_KEYS — so platform agents/services (demo-validator.impact, and later
 *  scripture-resolver.impact) join the SAME owner ceremony just by being provisioned a key. Edition issuers
 *  that lack a key are still surfaced as skipped (data-integrity rule). */
export async function resolveContentSignerKeys(env: McpEnv): Promise<{ signers: Array<{ issuerName: string; issuerSa: Address; delegateKey: Address }>; skipped: Array<{ issuerName: string; reason: string }> }> {
  if (!env.RPC_URL || !env.GCP_SERVICE_ACCOUNT_JSON || !env.CONTENT_SIGNER_KEYS || !env.REGISTRY || !env.UNIVERSAL_RESOLVER) {
    throw new Error('content-signer KMS config missing (RPC_URL / GCP_SERVICE_ACCOUNT_JSON / CONTENT_SIGNER_KEYS / REGISTRY / UNIVERSAL_RESOLVER)');
  }
  const chainId = Number(env.CHAIN_ID ?? DEV_CHAIN_ID);
  const keys = JSON.parse(env.CONTENT_SIGNER_KEYS) as Record<string, string>;
  const naming = new AgentNamingClient({ rpcUrl: env.RPC_URL, chainId, registry: env.REGISTRY as Address, universalResolver: env.UNIVERSAL_RESOLVER as Address });
  const signers: Array<{ issuerName: string; issuerSa: Address; delegateKey: Address }> = [];
  // Per data-integrity rule: surface dropped names (missing key / unresolvable name) — never hide them.
  const skipped: Array<{ issuerName: string; reason: string }> = [];
  // Union: every edition issuer + every name explicitly provisioned a KMS key (agents/services).
  const names = Array.from(new Set([...EDITIONS.map((e) => e.issuerName), ...Object.keys(keys)]));
  for (const issuerName of names) {
    const keyName = keys[issuerName];
    if (!keyName) { skipped.push({ issuerName, reason: 'no key in CONTENT_SIGNER_KEYS' }); continue; }
    const issuerSa = (await naming.resolveName(issuerName)) as Address | null;
    if (!issuerSa) { skipped.push({ issuerName, reason: 'agent-naming did not resolve this name' }); continue; }
    const kms = new GcpKmsSigner({ cryptoKeyVersionName: keyName, serviceAccountJson: env.GCP_SERVICE_ACCOUNT_JSON });
    signers.push({ issuerName, issuerSa, delegateKey: await kms.getSignerAddress() });
  }
  return { signers, skipped };
}

/**
 * Build a DELEGATED credential signer for ANY issuer name that has a stored, owner-signed delegation
 * (content_signers) — so a caller can sign a credential AS that identity with NO held key, the same way
 * buildDelegated signs per-edition content. Resolves: name → SA, the issuer's Cloud-KMS delegate
 * (CONTENT_SIGNER_KEYS), and the stored leaf; returns a CredentialSigner (KMS signDigest) + the
 * delegatingSigner to carry on the credential. Used by /tools/sign_content_credential so the resolver
 * agent (scripture-resolver.impact) signs its citations via the SA's HSM delegate. Returns { error } if
 * not fully configured / the identity isn't authorized yet / the stored leaf drifted from the live SA+key.
 */
export async function contentSignerForIssuer(
  env: McpEnv,
  issuerName: string,
): Promise<{ signer: CredentialSigner; delegatingSigner: DelegatingSigner; issuerSa: Address; chainId: number } | { error: string }> {
  if (!env.RPC_URL || !env.GCP_SERVICE_ACCOUNT_JSON || !env.CONTENT_SIGNER_KEYS || !env.REGISTRY || !env.UNIVERSAL_RESOLVER) {
    return { error: 'content-signer KMS config missing (RPC_URL / GCP_SERVICE_ACCOUNT_JSON / CONTENT_SIGNER_KEYS / REGISTRY / UNIVERSAL_RESOLVER)' };
  }
  if (!env.DB) return { error: 'no DB' };
  const chainId = Number(env.CHAIN_ID ?? DEV_CHAIN_ID);
  const keys = JSON.parse(env.CONTENT_SIGNER_KEYS) as Record<string, string>;
  const keyName = keys[issuerName];
  if (!keyName) return { error: `no KMS key for ${issuerName} in CONTENT_SIGNER_KEYS` };
  const naming = new AgentNamingClient({ rpcUrl: env.RPC_URL, chainId, registry: env.REGISTRY as Address, universalResolver: env.UNIVERSAL_RESOLVER as Address });
  const issuerSa = (await naming.resolveName(issuerName)) as Address | null;
  if (!issuerSa) return { error: `${issuerName} does not resolve to an SA` };
  const kms = new GcpKmsSigner({ cryptoKeyVersionName: keyName, serviceAccountJson: env.GCP_SERVICE_ACCOUNT_JSON });
  const delegateKey = await kms.getSignerAddress();
  const row = await env.DB.prepare('SELECT delegation_leaf, delegate_key, issuer_sa FROM content_signers WHERE issuer_name=?')
    .bind(issuerName)
    .first<{ delegation_leaf: string; delegate_key: string; issuer_sa: string }>();
  if (!row) return { error: `no stored delegation for ${issuerName} (run the demo-corpus "Authorize content signing" ceremony)` };
  if (row.issuer_sa.toLowerCase() !== issuerSa.toLowerCase()) return { error: `stored SA ${row.issuer_sa} ≠ resolved SA ${issuerSa} (re-authorize)` };
  if (row.delegate_key.toLowerCase() !== delegateKey.toLowerCase()) return { error: `stored delegate ${row.delegate_key} ≠ KMS key ${delegateKey} (re-authorize)` };
  // spec 276 §7 — credential signer built from the KMS backend via kmsCredentialSigner (no hand-rolled signDigest).
  return {
    signer: kmsCredentialSigner({ backend: kms, issuerAddress: issuerSa, chainId, verifyingContract: issuerSa }),
    delegatingSigner: { delegatorIssuer: issuerSa, delegateKey, delegationLeaf: JSON.parse(row.delegation_leaf) },
    issuerSa,
    chainId,
  };
}

/** Verify an owner-signed signer-delegation leaf BEFORE storing it. The name must resolve to the claimed SA
 *  (anti-spoof), the leaf must bind that SA → the delegate key, and the issuer SA must have SIGNED
 *  hashDelegation(leaf) (ERC-1271). This is the cryptographic authorization — only an identity's true
 *  custodian can produce a leaf its SA validates — so storing needs no privileged access gate. Per-custodian:
 *  bsb.impact / lbsb.impact / demo-validator.impact are each authorized only by whoever custodies that SA. */
export async function verifyContentSignerLeaf(
  env: McpEnv,
  input: { issuerName: string; issuerSa: Address; delegateKey: Address; delegationLeaf: unknown },
): Promise<{ ok: boolean; reason?: string }> {
  try {
    if (!env.RPC_URL || !env.REGISTRY || !env.UNIVERSAL_RESOLVER || !env.FACTORY || !env.ENTRY_POINT || !env.DELEGATION_MANAGER) {
      return { ok: false, reason: 'verification config missing (RPC_URL/REGISTRY/UNIVERSAL_RESOLVER/FACTORY/ENTRY_POINT/DELEGATION_MANAGER)' };
    }
    const chainId = Number(env.CHAIN_ID ?? DEV_CHAIN_ID);
    const naming = new AgentNamingClient({ rpcUrl: env.RPC_URL, chainId, registry: env.REGISTRY as Address, universalResolver: env.UNIVERSAL_RESOLVER as Address });
    const aac = new AgentAccountClient({ rpcUrl: env.RPC_URL, factory: env.FACTORY as Address, entryPoint: env.ENTRY_POINT as Address, chainId });
    const resolved = (await naming.resolveName(input.issuerName)) as Address | null;
    if (!resolved || resolved.toLowerCase() !== input.issuerSa.toLowerCase()) return { ok: false, reason: `${input.issuerName} does not resolve to ${input.issuerSa}` };
    const leaf = input.delegationLeaf as { delegator?: string; delegate?: string; signature?: Hex };
    if (!leaf?.delegator || !leaf?.delegate || !leaf?.signature) return { ok: false, reason: 'leaf missing delegator/delegate/signature' };
    if (leaf.delegator.toLowerCase() !== input.issuerSa.toLowerCase()) return { ok: false, reason: 'leaf delegator ≠ issuer SA' };
    if (leaf.delegate.toLowerCase() !== input.delegateKey.toLowerCase()) return { ok: false, reason: 'leaf delegate ≠ delegate key' };
    const leafHash = hashDelegation(leaf as Parameters<typeof hashDelegation>[0], chainId, env.DELEGATION_MANAGER as Address);
    const valid = await aac.isValidSignature(input.issuerSa, leafHash, leaf.signature);
    if (!valid) return { ok: false, reason: 'issuer SA did not sign the delegation (ERC-1271 rejected) — only the identity’s custodian can authorize it' };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

let cached: Promise<TrustContext> | null = null;

/** Resolve (once, cached) the trust context for this Worker from its env. */
export function resolveTrust(env: McpEnv): Promise<TrustContext> {
  if (!cached) {
    cached =
      env?.TRUST_MODE === 'delegated' ? buildDelegated(env)
      : env?.TRUST_MODE === 'onchain' ? buildOnchain(env)
      : Promise.resolve(buildDev());
  }
  return cached;
}
