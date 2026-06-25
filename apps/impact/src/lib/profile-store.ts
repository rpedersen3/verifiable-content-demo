// The member's COMMUNITY CONTACT profile (name/email/phone/org), re-used across community apps.
// spec 278: persisted in the member's PER-PERSON ENCRYPTED vault at impact-mcp (the
// `vault:impact-profile` record, sealed under the member's own GCP Cloud KMS KEK), NOT browser
// localStorage. The home holds no key material and no copy: it reads/writes over the same-origin
// `/mcp-bind` proxy by minting an OAuth token for the logged-in member and calling the
// owner-reads/writes-own `get_impact_profile` / `set_impact_profile` tools. No binding (the member
// hasn't run the connected-custodian ceremony at /account → Activate vault key) ⇒ fail-closed
// (`vault_key_unauthorized`). Ported from agenticprimitives/demo-sso-next/src/profile-store.ts.

import type { Address } from "@agenticprimitives/types";

export interface ImpactContactProfile {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  country?: string;
  city?: string;
  organizationName?: string;
  organizationCountry?: string;
}

export interface StoredAttestation {
  docHash: string;
  docId: string;
  signedAt: number;
  consentBoundTo: string;
}

export interface ImpactStoredProfile {
  v: 1;
  contact?: ImpactContactProfile;
  attestations?: { wea?: StoredAttestation };
}

export type ImpactProfileFieldKey = keyof ImpactContactProfile;

/** Raised when the member has no vault-key binding yet (must run the activation ceremony first). */
export class VaultKeyUnauthorizedError extends Error {
  constructor() {
    super("vault_key_unauthorized");
    this.name = "VaultKeyUnauthorizedError";
  }
}

export const PROFILE_FIELDS: { key: ImpactProfileFieldKey; label: string; type: "email" | "tel" | "text"; placeholder: string; help: string }[] = [
  { key: "firstName", label: "First name", type: "text", placeholder: "Rich", help: "Used to greet you across community apps." },
  { key: "lastName", label: "Last name", type: "text", placeholder: "Pedersen", help: "Used with your first name to render a friendly display name." },
  { key: "email", label: "Email", type: "email", placeholder: "you@example.com", help: "How community apps reach you. Shared on your terms." },
  { key: "phone", label: "Phone", type: "tel", placeholder: "+1 555 0100", help: "Optional. Shared only when you explicitly grant the scope." },
  { key: "country", label: "Country", type: "text", placeholder: "United States", help: "Where you live." },
  { key: "city", label: "City", type: "text", placeholder: "San Francisco", help: "Optional. Useful for local-team apps." },
  { key: "organizationName", label: "Organization name", type: "text", placeholder: "Grace Community Church", help: "If you act on behalf of a church, organization, or network." },
  { key: "organizationCountry", label: "Organization country", type: "text", placeholder: "United States", help: "Where your organization is based." },
];

const MCP_BIND = "/mcp-bind";

async function mintToken(principal: Address): Promise<string> {
  const res = await fetch(`${MCP_BIND}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ principal }),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (body.error === "vault_key_unauthorized") throw new VaultKeyUnauthorizedError();
  if (!res.ok || !body.access_token) throw new Error(`mint failed: ${body.error ?? res.status}`);
  return body.access_token;
}

async function callMcp(token: string, tool: string, args?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`${MCP_BIND}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ tool, args: args ?? {} }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (body.error === "vault_key_unauthorized") throw new VaultKeyUnauthorizedError();
  return body;
}

/** Read the member's encrypted community profile. Empty profile if never saved. Throws
 *  `VaultKeyUnauthorizedError` if they haven't activated their vault key yet. */
export async function loadImpactProfile(addr: Address): Promise<ImpactStoredProfile> {
  const token = await mintToken(addr);
  const out = await callMcp(token, "get_impact_profile");
  const record = out.record as ImpactStoredProfile | null | undefined;
  if (record && record.v === 1) return record;
  return { v: 1 };
}

/** Seal the member's community profile into their vault under their own KEK. Throws
 *  `VaultKeyUnauthorizedError` if they haven't activated their vault key yet. */
export async function saveImpactProfile(addr: Address, profile: ImpactStoredProfile): Promise<void> {
  const token = await mintToken(addr);
  const out = await callMcp(token, "set_impact_profile", { data: profile });
  if (out.ok !== true) throw new Error(`save failed: ${String(out.error ?? "unknown")}`);
}
