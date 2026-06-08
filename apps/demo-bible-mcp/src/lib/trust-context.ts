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
import { recoverAddress, type Hex } from 'viem';
import type { Address } from '@agenticprimitives/types';
import type { SignatureVerifier } from '@agenticprimitives/content-primitives';
import type { CredentialSigner } from '@agenticprimitives/verifiable-credentials';
import { AgentAccountClient } from '@agenticprimitives/agent-account';
import { AgentNamingClient } from '@agenticprimitives/agent-naming';
import { issuerAccount, DEV_ISSUER } from '../editions/registry.js';

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
}

export interface TrustContext {
  mode: 'dev' | 'onchain';
  issuer: Address;
  /** agent-naming name the issuer was resolved from (onchain only). */
  issuerName?: string;
  /** Sign a 32-byte digest the way this mode's verifier expects. */
  signDigest: (hash: Hex) => Promise<Hex>;
  /** Verify a signature over a digest by `signer` (descriptors + credentials). */
  verifySignature: SignatureVerifier;
  /** Issuers admitted by the demo trust profile. */
  trustedIssuers: Address[];
  /** Credential signer for issuing Entitlement VCs. */
  credentialSigner: CredentialSigner;
}

const DEV_CHAIN_ID = 31337;

function buildDev(): TrustContext {
  const signDigest = (hash: Hex) => issuerAccount.sign({ hash });
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
    credentialSigner: { issuerAddress: DEV_ISSUER, chainId: DEV_CHAIN_ID, verifyingContract: DEV_ISSUER, signDigest },
  };
}

async function buildOnchain(env: McpEnv): Promise<TrustContext> {
  const need = (k: keyof McpEnv) => {
    const v = env[k];
    if (!v) throw new Error(`TRUST_MODE=onchain requires env ${k}`);
    return v;
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

  return {
    mode: 'onchain',
    issuer,
    issuerName,
    signDigest,
    verifySignature: ({ signer, hash, signature }) => aac.isValidSignature(signer, hash, signature),
    trustedIssuers: [issuer],
    credentialSigner: { issuerAddress: issuer, chainId, verifyingContract: issuer, signDigest },
  };
}

let cached: Promise<TrustContext> | null = null;

/** Resolve (once, cached) the trust context for this Worker from its env. */
export function resolveTrust(env: McpEnv): Promise<TrustContext> {
  if (!cached) cached = env?.TRUST_MODE === 'onchain' ? buildOnchain(env) : Promise.resolve(buildDev());
  return cached;
}
