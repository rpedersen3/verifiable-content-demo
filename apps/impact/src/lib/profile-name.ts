// A friendly display name derived from the member's vault profile (first + last), used in the
// account menu instead of the raw address once it's available. Cached per-address in localStorage
// so it shows instantly (no flash of address) and survives reloads; refreshed best-effort from the
// vault and broadcast via a window event so the menu updates the moment the profile is saved.

import { loadImpactProfile, type ImpactContactProfile } from "./profile-store";
import { hasCachedSelfDelegation, type AccessContext } from "./access";

const keyFor = (a: string) => `impact.profileName.${a.toLowerCase()}`;
const EVENT = "impact:profile-name";

/** Friendly "First Last" from a contact profile, or null if neither is set. */
export function displayNameFromContact(c: ImpactContactProfile | undefined): string | null {
  const name = [c?.firstName, c?.lastName].map((s) => (s ?? "").trim()).filter(Boolean).join(" ").trim();
  return name || null;
}

export function cachedProfileName(addr: string): string | null {
  if (typeof window === "undefined") return null;
  try { return localStorage.getItem(keyFor(addr)) || null; } catch { return null; }
}

export function setCachedProfileName(addr: string, name: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (name) localStorage.setItem(keyFor(addr), name);
    else localStorage.removeItem(keyFor(addr));
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { addr, name } }));
  } catch { /* ignore */ }
}

/** Subscribe to profile-name changes (returns an unsubscribe fn). */
export function onProfileNameChange(cb: (addr: string, name: string | null) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const h = (e: Event) => { const d = (e as CustomEvent).detail as { addr: string; name: string | null }; cb(d.addr, d.name); };
  window.addEventListener(EVENT, h);
  return () => window.removeEventListener(EVENT, h);
}

/** Best-effort, NON-INTERACTIVE fetch of the friendly name from the member's vault. This runs on the
 *  topbar on every page, so it must NEVER trigger a signing gesture: for a self subject it reads only
 *  when a valid session delegation is already cached (an explicit vault/profile visit mints one).
 *  Returns null otherwise — the menu falls back to the cached name / address. Never throws. */
export async function fetchProfileName(ctx: AccessContext): Promise<string | null> {
  if (ctx.kind === "self" && !hasCachedSelfDelegation(ctx.personSA)) return null;
  try {
    const p = await loadImpactProfile(ctx);
    return displayNameFromContact(p.contact);
  } catch {
    return null;
  }
}
