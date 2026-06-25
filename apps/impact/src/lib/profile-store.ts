// The member's COMMUNITY CONTACT profile (name/email/phone/org), re-used across community apps.
// spec 278: persisted in the SUBJECT's PER-PERSON ENCRYPTED vault at impact-mcp (the
// `vault:impact-profile` record, sealed under its own GCP Cloud KMS KEK), NOT browser localStorage.
// Access is DELEGATION-presented (custody ≠ access): the read/write is authorized by a signed
// delegation (self → a person→person session delegation; org → the org→person stewardship grant),
// carried over impact-a2a's /mcp/vault/{get,set} which mints an MCP token with `sub = the
// delegation's delegator`. No binding (the subject hasn't run the connected-custodian ceremony at
// /account → Activate vault key) ⇒ fail-closed (`vault_key_unauthorized`). See src/lib/access.ts.

import { readVaultRecord, writeVaultRecord, VaultKeyUnauthorizedError, type AccessContext } from "./access";

// Re-exported so existing importers (vault/profile/account pages) keep a single source.
export { VaultKeyUnauthorizedError };
export type { AccessContext };

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

/** spec 278 vault resource (`vault:impact-profile`) — read/written over the generic delegation-
 *  presented vault path (impact-a2a /mcp/vault/{get,set}), same record as the get_impact_profile tool. */
const PROFILE_RECORD = "impact-profile";

/** Read the subject's encrypted community profile over a presented delegation. Empty profile if never
 *  saved. Throws `VaultKeyUnauthorizedError` if the subject's vault isn't activated. */
export async function loadImpactProfile(ctx: AccessContext): Promise<ImpactStoredProfile> {
  const record = await readVaultRecord<ImpactStoredProfile>(ctx, PROFILE_RECORD);
  return record && record.v === 1 ? record : { v: 1 };
}

/** Seal the subject's community profile into its vault, over a presented delegation. Throws
 *  `VaultKeyUnauthorizedError` if the subject's vault isn't activated. */
export async function saveImpactProfile(ctx: AccessContext, profile: ImpactStoredProfile): Promise<void> {
  await writeVaultRecord(ctx, PROFILE_RECORD, profile);
}
