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
import { bytesToHex, toBytes } from 'viem';
import type { Address } from '@agenticprimitives/types';
import type { SignatureVerifier, DelegatedAuthorityVerifier, DelegatingSigner } from '@agenticprimitives/content-primitives';
import type { CredentialSigner } from '@agenticprimitives/verifiable-credentials';
import { AgentAccountClient } from '@agenticprimitives/agent-account';
import { AgentNamingClient } from '@agenticprimitives/agent-naming';
import { GcpKmsSigner } from '@agenticprimitives/key-custody';
import { hashDelegation } from '@agenticprimitives/delegation';
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
  const issuerNames = Array.from(new Set(EDITIONS.map((e) => e.issuerName)));
  type Resolved = { issuerSa: Address; delegateKey: Address; signDigest: (h: Hex) => Promise<Hex>; leaf: unknown };
  const byIssuer = new Map<string, Resolved>();
  for (const issuerName of issuerNames) {
    const keyName = keys[issuerName];
    if (!keyName) throw new Error(`TRUST_MODE=delegated: CONTENT_SIGNER_KEYS has no KMS key for issuer ${issuerName}`);
    const issuerSa = (await naming.resolveName(issuerName)) as Address | null;
    if (!issuerSa) throw new Error(`agent-naming could not resolve ${issuerName}`);
    const kms = new GcpKmsSigner({ cryptoKeyVersionName: keyName, serviceAccountJson: saJson });
    const delegateKey = await kms.getSignerAddress();
    const signDigest = async (hash: Hex): Promise<Hex> => bytesToHex((await kms.signA2AAction({ digest: toBytes(hash) })).signature);
    const row = env.DB
      ? await env.DB.prepare('SELECT delegation_leaf, delegate_key FROM content_signers WHERE issuer_name=?').bind(issuerName).first<{ delegation_leaf: string; delegate_key: string }>()
      : null;
    if (!row) throw new Error(`TRUST_MODE=delegated: no content-signer delegation stored for ${issuerName} — run the demo-corpus "Authorize content signing" ceremony`);
    if (row.delegate_key.toLowerCase() !== delegateKey.toLowerCase()) throw new Error(`stored delegate ${row.delegate_key} ≠ KMS key address ${delegateKey} for ${issuerName}`);
    byIssuer.set(issuerName, { issuerSa, delegateKey, signDigest, leaf: JSON.parse(row.delegation_leaf) });
  }
  const issuerOf = (entry: EditionEntry): Resolved => {
    const d = byIssuer.get(entry.issuerName);
    if (!d) throw new Error(`no delegated content signer for issuer ${entry.issuerName}`);
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
      signer: { issuerAddress: d.issuerSa, chainId, verifyingContract: d.issuerSa, signDigest: d.signDigest } as CredentialSigner,
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

  const primary = issuerOf(EDITIONS[0]!);
  return {
    mode: 'delegated',
    issuer: primary.issuerSa,
    issuerName: EDITIONS[0]!.issuerName,
    signDigest: primary.signDigest,
    verifySignature,
    trustedIssuers: Array.from(byIssuer.values()).map((d) => d.issuerSa),
    credentialSigner: credentialSignerForEdition(EDITIONS[0]!.edition).signer,
    corpusRootReader,
    cacheKey: `delegated:${issuerNames.join(',')}`,
    signerForEdition,
    verifyDelegatedAuthority,
    credentialSignerForEdition,
  };
}

/** Derive the per-issuer Cloud-KMS content-signing key ADDRESSES (no signing, no held key) so the
 *  demo-corpus ceremony knows which key each issuer must authorize. Returns issuerName + issuer SA +
 *  the KMS key's derived address per distinct edition issuer. */
export async function resolveContentSignerKeys(env: McpEnv): Promise<Array<{ issuerName: string; issuerSa: Address; delegateKey: Address }>> {
  if (!env.RPC_URL || !env.GCP_SERVICE_ACCOUNT_JSON || !env.CONTENT_SIGNER_KEYS || !env.REGISTRY || !env.UNIVERSAL_RESOLVER) {
    throw new Error('content-signer KMS config missing (RPC_URL / GCP_SERVICE_ACCOUNT_JSON / CONTENT_SIGNER_KEYS / REGISTRY / UNIVERSAL_RESOLVER)');
  }
  const chainId = Number(env.CHAIN_ID ?? DEV_CHAIN_ID);
  const keys = JSON.parse(env.CONTENT_SIGNER_KEYS) as Record<string, string>;
  const naming = new AgentNamingClient({ rpcUrl: env.RPC_URL, chainId, registry: env.REGISTRY as Address, universalResolver: env.UNIVERSAL_RESOLVER as Address });
  const out: Array<{ issuerName: string; issuerSa: Address; delegateKey: Address }> = [];
  for (const issuerName of Array.from(new Set(EDITIONS.map((e) => e.issuerName)))) {
    const keyName = keys[issuerName];
    if (!keyName) continue;
    const issuerSa = (await naming.resolveName(issuerName)) as Address | null;
    if (!issuerSa) continue;
    const kms = new GcpKmsSigner({ cryptoKeyVersionName: keyName, serviceAccountJson: env.GCP_SERVICE_ACCOUNT_JSON });
    out.push({ issuerName, issuerSa, delegateKey: await kms.getSignerAddress() });
  }
  return out;
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
