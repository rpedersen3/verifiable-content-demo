// Whitelabel config — the "Impact" faith vertical. Branding + member-facing
// vocabulary live here so the substrate stays vertical-agnostic (same pattern as
// impact's src/whitelabel). Tone: warm, unhurried, stewardship language.

import type { Via } from "@/context/session";

export interface BrandConfig {
  name: string;
  tagline: string;
  community: string;
}

export const brand: BrandConfig = {
  name: "Impact",
  tagline: "A home for people and organizations to connect and steward their agents.",
  community: "the faith community",
};

export const credentialMethods: { via: Via; label: string; hint: string }[] = [
  { via: "passkey", label: "Use a passkey", hint: "Secure this home on your device — only you can open it" },
  { via: "google", label: "Continue with Google", hint: "We derive your agent; no password to manage" },
  { via: "youversion", label: "Continue with YouVersion", hint: "Bring your Bible app identity" },
  { via: "wallet", label: "Connect a wallet", hint: "Sign in with an existing Ethereum account" },
];

// Member-facing copy (vs crypto jargon): home / secure / register / give permission.
export const copy = {
  enterTitle: "Welcome to your home",
  enterSub: "Your own place in {community} — you own it, and only you open it.",
  stewardVerb: {
    org: "help oversee",
    treasury: "help manage",
    service: "help operate",
  },
};
