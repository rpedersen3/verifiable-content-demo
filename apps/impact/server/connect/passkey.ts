// POST /connect/passkey { credentialIdDigest, pubKeyX, pubKeyY, challenge, signature, aud }
// → resolve the passkey to its DETERMINISTIC SA on-chain + verify proof-of-possession,
// then issue an AgentSession (or signal bootstrap).
//
// Like /connect/siwe, resolution is deterministic: the SA address is the CREATE2 of
// `{ custodians:[], passkey:{credentialIdDigest,x,y,rpIdHash}, salt:0 }` (the shape the
// passkey-direct deploy uses). The factory commits `initialPasskeyRpIdHash` into the
// CREATE2, so rpIdHash (sha256 of the WebAuthn rp host) is PART of the address — the client
// sends the SAME rpIdHash it baked at deploy, or we'd compute a different (never-deployed)
// address and wrongly return bootstrap forever (which then makes the next attempt re-deploy
// an already-existing SA → EntryPoint AA25). Confirm on-chain (isDeployed + hasPasskey, with a short
// poll for post-deploy RPC lag), prove possession (isValidSignature over the single-use
// challenge), then RECONNECT (mint a custody-grade session + record the facet). If the
// SA doesn't exist yet → bootstrap. No KV facet needed — so an SA created in any flow is
// recognized, and a freshly-deployed one isn't re-deployed (no AA25).
import { mintAgentSession } from '@agenticprimitives/connect';
import { AgentAccountClient } from '@agenticprimitives/agent-account';
import { toCanonicalAgentId } from '@agenticprimitives/identity-directory-adapters';
import type { Address, CredentialPrincipal, Hex } from '@agenticprimitives/types';
import { getServer, json, resolveOrigin, type FnContext } from '../_lib/server-broker';
import { recordCredentialFacet } from '../../src/lib/kv-indexer';
import { CHAIN_ID, CONTRACTS, DEFAULT_RPC_URL } from '../../src/lib/chain';

/** Poll isDeployed a few times to ride out Base Sepolia's post-deploy RPC lag. */
async function isDeployedSoon(accounts: AgentAccountClient, sa: Address): Promise<boolean> {
  for (let i = 0; i < 6; i++) {
    if (await accounts.isDeployed(sa)) return true;
    if (i < 5) await new Promise((r) => setTimeout(r, 2500));
  }
  return false;
}

export const onRequestPost = async ({ request, env }: FnContext): Promise<Response> => {
  const body = (await request.json().catch(() => null)) as
    | { credentialIdDigest?: string; pubKeyX?: string; pubKeyY?: string; rpIdHash?: string; challenge?: string; signature?: string; aud?: string; agent?: string }
    | null;
  // A RECOVERY passkey reconnect targets a KNOWN home SA (`agent`): the passkey was added as a
  // custodian of a social/wallet home via `addPasskey`, so it does NOT derive a passkey-native SA.
  // In that mode we skip rpIdHash/pubkey derivation entirely and gate purely on hasPasskey(agent,·)
  // + proof-of-possession against that SA. Otherwise (bootstrap/deploy path) the SA is DERIVED from
  // the passkey and rpIdHash is required (it's committed into the CREATE2 address).
  const target = body?.agent && /^0x[0-9a-fA-F]{40}$/.test(body.agent) ? (body.agent as Address) : null;
  if (!body?.credentialIdDigest || !body.challenge || !body.signature || !body.aud) {
    return json({ error: 'credentialIdDigest, challenge, signature, aud required' }, 400);
  }
  if (!target && (!body.pubKeyX || !body.pubKeyY || !body.rpIdHash)) {
    return json({ error: 'pubKeyX, pubKeyY, rpIdHash required (or pass a target agent for a recovery-passkey login)' }, 400);
  }
  // rpIdHash is part of the passkey SA's CREATE2 address; the client sends the same value
  // it baked at deploy (sha256 of the browser host). It only LOCATES the account — trust is
  // gated below by hasPasskey + proof-of-possession (isValidSignature), so a forged rpIdHash
  // can only ever resolve to an SA the caller already controls. Validate it's a bytes32.
  if (!target && !/^0x[0-9a-fA-F]{64}$/.test(body.rpIdHash!)) {
    return json({ error: 'rpIdHash must be a 32-byte hex string' }, 400);
  }
  // SEC-024: gate iss through the Host allowlist (closes the gap SEC-006 left on the
  // Connect-auth code path; the broker must NEVER sign sessions with a foreign Host).
  const iss = resolveOrigin(request, env);

  // Single-use challenge.
  const key = `pkchallenge:${body.challenge}`;
  if (!(await env.AUTH_CODES.get(key))) return json({ error: 'unknown or expired challenge' }, 400);
  await env.AUTH_CODES.delete(key);

  const principal: CredentialPrincipal = {
    kind: 'passkey',
    id: body.credentialIdDigest,
    assurance: 'onchain-confirmed',
    role: 'custody-grade',
  };

  const accounts = new AgentAccountClient({
    rpcUrl: env.RPC_URL ?? DEFAULT_RPC_URL,
    chainId: CHAIN_ID,
    entryPoint: CONTRACTS.entryPoint,
    factory: CONTRACTS.agentAccountFactory,
  });

  // Recovery-passkey login → the SA is the caller-supplied home directly (verified below by
  // hasPasskey + proof-of-possession). Otherwise derive the deterministic passkey-native SA
  // (mode 0, no custodians, passkey set, salt 0). rpIdHash is committed into the CREATE2 by the
  // factory, so it MUST be included to match the deployed address — use the client-supplied value.
  let sa: Address;
  if (target) {
    sa = target;
  } else {
    try {
      sa = await accounts.getAddressForAgentAccount({
        mode: 0,
        custodians: [],
        passkey: { credentialIdDigest: body.credentialIdDigest as Hex, x: BigInt(body.pubKeyX!), y: BigInt(body.pubKeyY!), rpIdHash: body.rpIdHash as Hex },
        salt: 0n,
      });
    } catch (e) {
      return json({ error: 'SA address derivation failed', detail: String(e) }, 502);
    }
  }

  // For a recovery target the home is already deployed; a false "not deployed" here would be a
  // stale RPC read, not a bootstrap signal — a targeted login never deploys, so surface it as an error.
  if (!(await isDeployedSoon(accounts, sa))) {
    return target ? json({ error: 'target home is not deployed on-chain' }, 409) : json({ status: 'bootstrap' });
  }
  if (!(await accounts.hasPasskey(sa, body.credentialIdDigest as Hex))) {
    return target ? json({ error: 'this passkey is not a registered custodian of the target home' }, 403) : json({ status: 'bootstrap' });
  }

  // Proof-of-possession: the registered passkey must have signed THIS challenge.
  const valid = await accounts.isValidSignature(sa, body.challenge as Hex, body.signature as Hex);
  if (!valid) return json({ error: 'passkey signature invalid (proof-of-possession failed)' }, 401);

  const sub = toCanonicalAgentId(CHAIN_ID, sa);
  const { signer } = await getServer(env);
  const token = await mintAgentSession(
    { sub, principal, assurance: 'onchain-confirmed', aud: body.aud, iss, ttlSeconds: 3600 },
    signer,
  );
  await recordCredentialFacet(env.AUTH_CODES, principal, sub);
  return json({ status: 'issued', token, agent: sa });
};
