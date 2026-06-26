// An organization's PUBLIC-ish profile (display name, mission, sector, website, contact, location),
// persisted in the ORG's per-agent encrypted vault at impact-mcp (the `vault:impact-org-profile`
// record, sealed under the org's own KEK). Access is delegation-presented (custody ≠ access): the
// custodian reads/writes it over the org→person stewardship grant via impact-a2a /mcp/vault/{get,set}.
// Mirrors src/lib/profile-store.ts, but org-shaped. No binding (org vault not activated) ⇒ fail-closed.

import { readVaultRecord, writeVaultRecord, VaultKeyUnauthorizedError, type AccessContext } from "./access";

export { VaultKeyUnauthorizedError };

export interface ImpactOrgProfile {
  displayName?: string;
  mission?: string;
  sector?: string;
  website?: string;
  contactEmail?: string;
  location?: string;
}

export interface ImpactStoredOrgProfile {
  v: 1;
  profile?: ImpactOrgProfile;
}

export type ImpactOrgProfileFieldKey = keyof ImpactOrgProfile;

export const ORG_PROFILE_FIELDS: { key: ImpactOrgProfileFieldKey; label: string; type: "text" | "email" | "url" | "textarea"; placeholder: string; help: string }[] = [
  { key: "displayName", label: "Display name", type: "text", placeholder: "Grace Community Church", help: "How this organization is shown across community apps." },
  { key: "sector", label: "Sector", type: "text", placeholder: "Church · Ministry · Coalition · Nonprofit", help: "What kind of organization this is." },
  { key: "mission", label: "Mission", type: "textarea", placeholder: "A short statement of what this organization exists to do.", help: "One or two sentences." },
  { key: "website", label: "Website", type: "url", placeholder: "https://example.org", help: "Public site, if any." },
  { key: "contactEmail", label: "Contact email", type: "email", placeholder: "hello@example.org", help: "How people reach this organization." },
  { key: "location", label: "Location", type: "text", placeholder: "San Francisco, CA", help: "Where it's based." },
];

const ORG_PROFILE_RECORD = "impact-org-profile";

/** Read the org's profile over a presented stewardship delegation. Empty if never saved. Throws
 *  `VaultKeyUnauthorizedError` if the org's vault isn't activated (for this resource). */
export async function loadImpactOrgProfile(ctx: AccessContext): Promise<ImpactOrgProfile> {
  const record = await readVaultRecord<ImpactStoredOrgProfile>(ctx, ORG_PROFILE_RECORD);
  return record && record.v === 1 && record.profile ? record.profile : {};
}

/** Seal the org's profile into its vault over a presented stewardship delegation. */
export async function saveImpactOrgProfile(ctx: AccessContext, profile: ImpactOrgProfile): Promise<void> {
  await writeVaultRecord(ctx, ORG_PROFILE_RECORD, { v: 1, profile } satisfies ImpactStoredOrgProfile);
}
