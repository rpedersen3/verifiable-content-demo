// BSB Corpus-Manager (bsb.impact) A2A agent wiring — assembles createA2aAgent from the platform
// (@agenticprimitives/a2a) with the Base Sepolia contracts, our SkillHandlers, and the mcp/vault
// seams. DEPLOYABLE-BUT-INERT: until A2A_RPC_URL + A2A_AGENT_SA (the claimed bsb.impact) are set,
// the on-chain checks fail closed (every task denied). Set the secrets/vars to "flip the switch".
//
// NOTE: the task store here is in-memory (per-isolate). Production uses the Durable Object store
// (createDurableObjectTaskStore from @agenticprimitives/a2a/cloudflare) — a follow-up at activation.

import { createPublicClient, http, keccak256, toHex, type Address, type Hex } from 'viem';
import { baseSepolia } from 'viem/chains';
import { hashDelegation, isRevoked as chainIsRevoked, type Delegation } from '@agenticprimitives/delegation';
import { verifyUserSignatureView } from '@agenticprimitives/connect-auth';
import {
  createA2aAgent,
  createInMemoryTaskStore,
  type A2aAgent,
  type OnChainChecks,
  type A2aEnforcers,
  type VaultClient,
  type McpClient,
  type A2aMessage,
  type TaskStore,
} from '@agenticprimitives/a2a';
import { BSB_AGENT_SKILLS } from './skills.js';

export type A2aEnv = {
  A2A_AGENT_SA?: string;
  A2A_RPC_URL?: string;
  A2A_CHAIN_ID?: string;
  A2A_DELEGATION_MANAGER?: string;
  A2A_UNIVERSAL_VALIDATOR?: string;
  A2A_ENF_TARGETS?: string;
  A2A_ENF_METHODS?: string;
  A2A_ENF_TIMESTAMP?: string;
  SELF_URL?: string;
};

const ZERO = '0x0000000000000000000000000000000000000000' as Address;
const addr = (v: string | undefined): Address => (v && v.startsWith('0x') ? (v as Address) : ZERO);

function makeChecks(env: A2aEnv, chainId: number, delegationManager: Address, universalValidator: Address): OnChainChecks {
  if (!env.A2A_RPC_URL) {
    // INERT: no RPC ⇒ fail closed on every check (deny all tasks) until activated.
    return { isRevoked: async () => true, verifyDelegationSignature: async () => false, verifyMessageSignature: async () => false };
  }
  const client = createPublicClient({ chain: baseSepolia, transport: http(env.A2A_RPC_URL) });
  return {
    async isRevoked(d: Delegation): Promise<boolean> {
      return chainIsRevoked(hashDelegation(d, chainId, delegationManager), { delegationManager, client } as never);
    },
    async verifyDelegationSignature(d: Delegation): Promise<boolean> {
      const r = await verifyUserSignatureView({ universalValidator, signer: d.delegator, hash: hashDelegation(d, chainId, delegationManager), signature: d.signature, client } as never);
      return (r as { ok?: boolean }).ok === true;
    },
    async verifyMessageSignature(m: A2aMessage, digest: Hex): Promise<boolean> {
      const r = await verifyUserSignatureView({ universalValidator, signer: m.sender, hash: digest, signature: m.signature, client } as never);
      return (r as { ok?: boolean }).ok === true;
    },
  };
}

// MCP seam — the handlers' ctx.mcp.callTool routes to OUR entitlement tools on this worker.
function makeMcpClient(env: A2aEnv): McpClient {
  const base = env.SELF_URL ?? 'https://demo-bible-mcp-production.richardpedersen3.workers.dev';
  return {
    async callTool({ tool, toolArgs }) {
      const r = await fetch(`${base}/tools/${tool}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(toolArgs ?? {}) });
      return r.json();
    },
  };
}

// Vault seam — emitArtifact / reader-vault delivery route through the relayer. Inert scaffold:
// a synthetic ref now; the real relayer set/get (reusing the A2A_RELAY path) is wired at activation.
function makeVaultClient(): VaultClient {
  return {
    async read(): Promise<unknown> { return null; },
    async write({ recordType }) { return { uri: `vault://${recordType}`, hash: keccak256(toHex(recordType)) } as never; },
  };
}

export function buildBsbAgent(env: A2aEnv, taskStore?: TaskStore): A2aAgent {
  const chainId = Number(env.A2A_CHAIN_ID ?? '84532');
  const delegationManager = addr(env.A2A_DELEGATION_MANAGER);
  const universalValidator = addr(env.A2A_UNIVERSAL_VALIDATOR);
  const enforcers: A2aEnforcers = { allowedTargets: addr(env.A2A_ENF_TARGETS), allowedMethods: addr(env.A2A_ENF_METHODS), timestamp: addr(env.A2A_ENF_TIMESTAMP) };
  return createA2aAgent({
    agentSA: addr(env.A2A_AGENT_SA),
    chainId,
    delegationManager,
    enforcers,
    taskStore: taskStore ?? createInMemoryTaskStore(),
    checks: makeChecks(env, chainId, delegationManager, universalValidator),
    handlers: BSB_AGENT_SKILLS,
    vault: makeVaultClient(),
    mcp: makeMcpClient(env),
    hashBody: (data: unknown): Hex => keccak256(toHex(JSON.stringify(data))),
  });
}
