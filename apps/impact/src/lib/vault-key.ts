// spec 278 P5 — vault-key ceremony (connected custodian), ONE-CLICK. Authorize impact-mcp to wield
// your PER-PERSON vault KEK: you sign a `VaultKeyAuthorization` (person SA → impact-mcp, one
// non-subdelegable VAULT_KEY_USE caveat) with YOUR credential (passkey / wallet); we POST the signed
// authorization to impact-mcp's /custody/vault-key/bind (same-origin via the /mcp-bind proxy). On
// success your vault flips from fail-closed to live. There is no global key — until you sign this,
// impact-mcp cannot decrypt your data at all (VKB-D1). The home holds no key material — it only signs
// the grant. Ported from agenticprimitives/demo-sso-next (delegation.ts + home/onboarding.ts).

import {
  type Delegation,
  buildVaultKeyUseCaveat,
  hashDelegation,
  ROOT_AUTHORITY,
} from "@agenticprimitives/delegation";
import type { Address, Hex } from "@agenticprimitives/types";
import { CHAIN_ID, CONTRACTS } from "./chain";
import { passkeySignHash } from "./connect";
import { connectWallet, personalSign } from "./wallet";
import { ensureCsrfToken, csrfHeaders } from "../csrf";

type SignHash = (hash: Hex) => Promise<Hex>;
export type Via = "passkey" | "wallet" | "google" | "youversion";

const MCP_BIND = "/mcp-bind";

export interface VaultKeyServerInfo {
  serverKey: Address;
  defaultResources: string[];
  classificationCeiling: string;
  ops: ("read" | "write")[];
}

interface CeremonyParams {
  vaultId: string;
  kmsKeyRef: string;
  serverKey: Address;
  allowedResources: string[];
  classificationCeiling: string;
  ops: ("read" | "write")[];
  validitySeconds?: number;
}

/** Resolve a SignHash for the member's credential. Passkey/wallet sign on device; OIDC
 *  (Google/YouVersion) homes are KMS-custodied — impact-a2a's per-(iss,sub) C_sub signs the
 *  digest server-side over the custody session (no device gesture), via /a2a/custody/google/sign
 *  (OIDC-generic: it derives the custodian from the session subject, so YouVersion works too). */
async function signHashFor(via: Via, owner: Address, token?: string): Promise<SignHash> {
  if (via === "wallet") {
    const addr = await connectWallet(true);
    return (h: Hex) => personalSign(addr, h);
  }
  if (via === "google" || via === "youversion") {
    if (!token) throw new Error("Activating a vault key for a social home needs a live custody session — sign in again.");
    return async (hash: Hex): Promise<Hex> => {
      await ensureCsrfToken();
      const res = await fetch("/a2a/custody/google/sign", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ session: token, hash, sender: owner }),
      });
      const b = (await res.json().catch(() => ({}))) as { ok?: boolean; signature?: Hex; error?: string; detail?: string };
      if (!res.ok || !b.ok || !b.signature) throw new Error([b.error, b.detail].filter(Boolean).join(" — ") || `custody sign failed (HTTP ${res.status})`);
      return b.signature;
    };
  }
  return passkeySignHash;
}

function buildVaultKeyAuthorization(owner: Address, p: CeremonyParams): { delegation: Delegation; digest: Hex; expiresAt: string } {
  const validUntil = Math.floor(Date.now() / 1000) + (p.validitySeconds ?? 60 * 60 * 24 * 90);
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let salt = 0n;
  for (const b of bytes) salt = (salt << 8n) | BigInt(b);
  const caveat = buildVaultKeyUseCaveat({
    vaultId: p.vaultId,
    kmsKeyRef: p.kmsKeyRef,
    resources: p.allowedResources,
    classificationCeiling: p.classificationCeiling,
    ops: p.ops,
    noSubdelegation: true,
  });
  const d: Delegation = {
    delegator: owner,
    delegate: p.serverKey,
    authority: ROOT_AUTHORITY,
    caveats: [caveat],
    salt,
    signature: "0x",
  };
  const digest = hashDelegation(d, CHAIN_ID, CONTRACTS.delegationManager);
  return { delegation: d, digest, expiresAt: new Date(validUntil * 1000).toISOString() };
}

/** Deploy a counterfactual SOCIAL (Google/YouVersion) home on-chain — nameless, gas-sponsored,
 *  idempotent. Required before any ERC-1271 op (vault-key authorization, delegations): an account
 *  with no code can't validate a signature. The per-(iss,sub) C_sub signs the deploy userOp
 *  server-side over the custody session (no device gesture). */
export async function secureSocialHome(token: string): Promise<{ ok: true; agent: Address } | { ok: false; error: string }> {
  await ensureCsrfToken();
  const res = await fetch("/a2a/custody/google/bootstrap", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ session: token }),
  });
  const b = (await res.json().catch(() => ({}))) as { ok?: boolean; agent?: Address; error?: string; detail?: string };
  if (!res.ok || !b.ok || !b.agent) return { ok: false, error: [b.error, b.detail].filter(Boolean).join(" — ") || `secure home failed (HTTP ${res.status})` };
  return { ok: true, agent: b.agent };
}

/** Fetch the server's delegate + authorized scope. */
export async function fetchVaultServerInfo(): Promise<VaultKeyServerInfo> {
  const info = (await (await fetch(`${MCP_BIND}/custody/vault-key/server-info`)).json()) as Partial<VaultKeyServerInfo>;
  return {
    serverKey: info.serverKey as Address,
    defaultResources: info.defaultResources ?? ["person-pii", "org-sensitive", "profile", "vault:impact-profile", "vault:impact-entitlements", "vault:impact-org-profile", "vault:impact-relationships"],
    classificationCeiling: info.classificationCeiling ?? "regulated.high",
    ops: info.ops ?? ["read", "write"],
  };
}

/** Does this owner (person or org SA) already have a live vault-key binding? A signature-free status
 *  check (`GET /custody/vault-key/is-bound`) so surfaces can show "vault active/inactive" WITHOUT
 *  presenting a delegation or triggering a signing gesture. */
export async function isVaultKeyBound(owner: Address): Promise<boolean> {
  try {
    const r = await fetch(`${MCP_BIND}/custody/vault-key/is-bound?owner=${owner}`);
    const b = (await r.json().catch(() => ({}))) as { ok?: boolean; bound?: boolean };
    return b.ok === true && b.bound === true;
  } catch { return false; }
}

/** Provision the owner's per-person KEK (idempotent). Returns the kmsKeyRef. */
export async function provisionVaultKey(owner: Address): Promise<{ ok: true; kmsKeyRef: string } | { ok: false; error: string }> {
  const prov = (await (await fetch(`${MCP_BIND}/custody/vault-key/provision`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ owner }),
  })).json()) as { ok?: boolean; kmsKeyRef?: string; error_description?: string; detail?: string; error?: string };
  if (!prov?.ok || !prov.kmsKeyRef) return { ok: false, error: prov?.error_description ?? prov?.detail ?? prov?.error ?? "could not provision your vault key" };
  return { ok: true, kmsKeyRef: prov.kmsKeyRef };
}

/** Build → sign → bind. The person SA signs the authorization (ERC-1271); impact-mcp records it. */
export async function bindVaultKey(
  owner: Address,
  params: CeremonyParams,
  via: Via = "passkey",
  token?: string,
): Promise<{ ok: true; kmsKeyRef: string } | { ok: false; error: string }> {
  try {
    const { delegation, digest, expiresAt } = buildVaultKeyAuthorization(owner, params);
    const signHash = await signHashFor(via, owner, token);
    delegation.signature = await signHash(digest);
    const res = await fetch(`${MCP_BIND}/custody/vault-key/bind`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        owner,
        vaultId: params.vaultId,
        kmsKeyRef: params.kmsKeyRef,
        allowedResources: params.allowedResources,
        classificationCeiling: params.classificationCeiling,
        ops: params.ops,
        expiresAt,
        authorization: { ...delegation, salt: delegation.salt.toString() },
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; reason?: string; error?: string };
    if (!res.ok || data.ok !== true) return { ok: false, error: data.reason ?? data.error ?? `vault-key bind failed (HTTP ${res.status})` };
    return { ok: true, kmsKeyRef: params.kmsKeyRef };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "vault-key bind failed" };
  }
}

/** One-call activation: provision (idempotent) → discover scope → bind. Pass the AgentSession
 *  `token` for social (Google/YouVersion) homes — it authorizes the custody-session signature. */
export async function activateVaultKey(owner: Address, via: Via, token?: string): Promise<{ ok: true; kmsKeyRef: string } | { ok: false; error: string }> {
  const prov = await provisionVaultKey(owner);
  if (!prov.ok) return prov;
  const info = await fetchVaultServerInfo();
  return bindVaultKey(
    owner,
    { vaultId: "impact-mcp", kmsKeyRef: prov.kmsKeyRef, serverKey: info.serverKey, allowedResources: info.defaultResources, classificationCeiling: info.classificationCeiling, ops: info.ops },
    via,
    token,
  );
}
