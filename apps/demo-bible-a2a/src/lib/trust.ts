// The resolving agent's signing identity = its custodian-controlled Smart Agent (A2A_AGENT_SA), NOT a held
// EOA. (Was a dev anvil key on chain 31337 — removed.) Citations are signed by the SA's Cloud-KMS delegate
// key VIA the MCP, which holds the KMS access + the owner-signed SA→key ERC-7710 delegation leaf (stored by
// the demo-corpus "Authorize content signing" ceremony). No private key lives in this worker. The signed
// citation carries `delegatingSigner` so a verifier roots trust in the SA (ERC-1271) while the day-to-day
// signer is the rotatable HSM key — the same delegated-trust model as the issuers + the validator.

import type { Address } from 'viem';

/** Base Sepolia. The agent's on-chain identity lives here (was dev-chain 31337 with an anvil EOA). */
export const DEFAULT_CHAIN_ID = 84532;

export interface AgentEnv {
  /** The resolver agent's Smart Agent (AgentAccount) address — its on-chain identity. NOT an EOA. */
  A2A_AGENT_SA?: string;
  A2A_CHAIN_ID?: string;
  /** The agent's .impact name; the MCP resolves it → the same SA to sign citations under. */
  AGENT_NAME?: string;
}

export interface AgentIdentity {
  agentSa: Address;
  agentName: string;
  /** CAIP-10 `eip155:<chain>:<SA>` — the bundle's agentId and the citation issuer. */
  agentDid: string;
  chainId: number;
}

/** Resolve the agent identity from worker env (Cloudflare env is per-request, so this is a function, not
 *  module constants). Fail-closed: callers must check `agentSa` is set before signing. */
export function agentIdentity(env: AgentEnv): AgentIdentity {
  const agentSa = (env.A2A_AGENT_SA ?? '') as Address;
  const chainId = Number(env.A2A_CHAIN_ID ?? DEFAULT_CHAIN_ID);
  const agentName = env.AGENT_NAME ?? 'scripture-resolver.impact';
  return { agentSa, agentName, agentDid: `eip155:${chainId}:${agentSa}`, chainId };
}
