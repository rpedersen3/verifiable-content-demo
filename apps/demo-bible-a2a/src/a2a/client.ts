// Scripture Agent → BSB Corpus-Manager: the CLIENT side of the async A2A bus (spec 269).
// resolve-on-behalf submits a `get-gated-passage` task to the BSB agent, presenting the reader's
// scoped delegation (delegator = reader, delegate = this Scripture Agent, allowedTargets = BSB SA,
// allowedMethods = get-gated-passage). INERT until the BSB agent is activated (RPC + claimed SA) and
// the reader supplies a buildA2aGrantCaveats-scoped grant — the BSB auth gate rejects otherwise.

import { keccak256, toHex, type Address, type Hex } from 'viem';
import { A2aWireAdapter, hashA2aMessage, buildA2aGrantCaveats, skillSelector, type A2aTransport, type A2aMessage } from '@agenticprimitives/a2a';
import type { Delegation } from '@agenticprimitives/delegation';
import { agentIdentity } from '../lib/trust.js';

export type BsbTargetEnv = {
  BSB_AGENT_URL?: string;
  BSB_AGENT_SA?: string;
  A2A_AGENT_SA?: string;
  A2A_CHAIN_ID?: string;
  AGENT_NAME?: string;
  MCP_URL?: string;
  MCP?: { fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> };
};

/** Sign a raw digest AS this agent's Smart Agent via its Cloud-KMS delegate, in the MCP (no held key). */
async function mcpSignDigest(env: BsbTargetEnv, digest: Hex): Promise<Hex> {
  const init = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ issuerName: env.AGENT_NAME ?? 'scripture-resolver.impact', digest }),
  };
  const r = env.MCP
    ? await env.MCP.fetch('https://mcp/tools/sign_agent_digest', init)
    : await fetch(`${(env.MCP_URL ?? 'http://127.0.0.1:8790').replace(/\/$/, '')}/tools/sign_agent_digest`, init);
  const j = (await r.json()) as { ok?: boolean; signature?: string; error?: string };
  if (!j.ok || !j.signature) throw new Error(`a2a message signing failed: ${j.error ?? 'unknown'}`);
  return j.signature as Hex;
}
export type GrantEnv = BsbTargetEnv & { A2A_ENF_TARGETS?: string; A2A_ENF_METHODS?: string; A2A_ENF_TIMESTAMP?: string };

const ZERO = '0x0000000000000000000000000000000000000000' as Address;
const addr = (v: string | undefined): Address => (v && v.startsWith('0x') ? (v as Address) : ZERO);

/** Build the SCOPED-GRANT spec a reader's home must mint so this Scripture Agent can call the BSB
 *  agent's `skill` on their behalf: delegate = this agent, allowedTargets = BSB SA, allowedMethods =
 *  the skill selector, + a timestamp window (buildA2aGrantCaveats). The reader requests a delegation
 *  with exactly these caveats from their Global.Church home; the agent then presents it (resolveOnBehalf). */
export function buildGrantSpec(env: GrantEnv, skill: string, nowSec: number): {
  delegate: Address; recipientAgent: Address; skill: string; methodSelector: Hex; caveats: unknown[];
} {
  const recipientAgent = (env.BSB_AGENT_SA ?? ZERO) as Address;
  const caveats = buildA2aGrantCaveats({
    recipientAgentSA: recipientAgent,
    skill,
    enforcers: { allowedTargets: addr(env.A2A_ENF_TARGETS), allowedMethods: addr(env.A2A_ENF_METHODS), timestamp: addr(env.A2A_ENF_TIMESTAMP) },
    window: { validAfter: nowSec - 60, validUntil: nowSec + 3600 },
  });
  return { delegate: agentIdentity(env).agentSa, recipientAgent, skill, methodSelector: skillSelector(skill), caveats };
}

// Transport: POST JSON-RPC to the BSB agent's /api/a2a. Prefer the MCP SERVICE BINDING (worker-to-worker,
// no public hop) — a direct fetch() to another workers.dev Worker hits Cloudflare error 1042.
function makeTransport(env: BsbTargetEnv): A2aTransport {
  const url = `${env.BSB_AGENT_URL ?? 'https://demo-bible-mcp-production.richardpedersen3.workers.dev'}/api/a2a`;
  return {
    async rpc(_target: Address, request) {
      const init = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) };
      const r = env.MCP ? await env.MCP.fetch('https://mcp/api/a2a', init) : await fetch(url, init);
      return r.json() as ReturnType<A2aTransport['rpc']>;
    },
  };
}

const rand32 = (): Hex => `0x${Array.from(crypto.getRandomValues(new Uint8Array(32))).map((x) => x.toString(16).padStart(2, '0')).join('')}` as Hex;

/** Submit a get-gated-passage task to the BSB agent on the reader's behalf. The message is signed by
 *  this agent (the requester); the reader's scoped delegation authorizes it. Returns the task handle. */
export async function resolveOnBehalf(
  env: BsbTargetEnv,
  args: { reference: string; edition: string; entitlement?: unknown; delegation: Delegation; createdAt: number },
): Promise<{ taskId: Hex; state: string }> {
  const bsbSA = (env.BSB_AGENT_SA ?? ZERO) as Address;
  const requester = agentIdentity(env).agentSa;
  const input = { reference: args.reference, edition: args.edition, entitlement: args.entitlement };
  const bodyHash = keccak256(toHex(JSON.stringify(input)));
  const base: A2aMessage = {
    messageId: rand32(),
    sender: requester,
    skill: 'get-gated-passage',
    bodyRef: { owner: requester, recordType: `a2a:msg:${bodyHash.slice(2, 18)}` },
    bodyHash,
    signature: '0x' as Hex,
    createdAt: args.createdAt,
  };
  const message: A2aMessage = { ...base, signature: await mcpSignDigest(env, hashA2aMessage(base)) };
  const adapter = new A2aWireAdapter(makeTransport(env));
  const res = await adapter.submitTask(bsbSA, { message, delegation: args.delegation, requester, input });
  return { taskId: res.taskId, state: res.state };
}

/** Poll the BSB agent for a submitted task's state (the reader's app would call this until terminal,
 *  then read the verse artifact + verify the Scripture Agent's CitationAssertion). */
export async function pollTask(env: BsbTargetEnv, taskId: Hex): Promise<unknown> {
  const adapter = new A2aWireAdapter(makeTransport(env));
  return adapter.getTask((env.BSB_AGENT_SA ?? ZERO) as Address, taskId, agentIdentity(env).agentSa);
}
