// A friendly DISPLAY NAME for an org, preferred over its `.impact` name or address wherever we have
// it. The display name lives in the org's encrypted vault (vault:impact-org-profile), so we cache it
// per-address in localStorage (populated whenever the org's profile is loaded/saved) — lists never do
// a vault read just to render a label. Mirrors src/lib/profile-name.ts. Falls back name → short addr.

import { useEffect, useState } from "react";

const keyFor = (a: string) => `impact.orgName.${a.toLowerCase()}`;
const EVENT = "impact:org-name";
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function cachedOrgDisplayName(addr: string): string | null {
  if (typeof window === "undefined") return null;
  try { return localStorage.getItem(keyFor(addr)) || null; } catch { return null; }
}

export function setCachedOrgDisplayName(addr: string, name: string | null | undefined): void {
  if (typeof window === "undefined") return;
  const v = (name ?? "").trim();
  try {
    if (v) localStorage.setItem(keyFor(addr), v);
    else localStorage.removeItem(keyFor(addr));
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { addr, name: v || null } }));
  } catch { /* ignore */ }
}

/** display name (vault profile) → the org's `.impact` name → short address. Synchronous. */
export function orgDisplay(addr: string, fallbackName?: string | null): string {
  return cachedOrgDisplayName(addr) || (fallbackName && fallbackName.trim() ? fallbackName : "") || short(addr);
}

/** Reactive variant for persistent surfaces (the switcher trigger, the topbar): re-renders when the
 *  org's profile is saved this session. */
export function useOrgDisplay(addr: string, fallbackName?: string | null): string {
  const [v, setV] = useState(() => orgDisplay(addr, fallbackName));
  useEffect(() => {
    setV(orgDisplay(addr, fallbackName));
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail as { addr: string };
      if (d.addr.toLowerCase() === addr.toLowerCase()) setV(orgDisplay(addr, fallbackName));
    };
    window.addEventListener(EVENT, h);
    return () => window.removeEventListener(EVENT, h);
  }, [addr, fallbackName]);
  return v;
}
