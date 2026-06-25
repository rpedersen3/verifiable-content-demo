// THE single source of demo-sso-next's deployment-domain config (ADR-0021).
// No other file in this app should hardcode a hostname or the name TLD — import
// from here. This module is deployment-specific BY DESIGN and must never be
// hoisted into packages/* (enforced by `pnpm check:no-domain-in-packages`).
//
// Impact is served on a single home domain (churchcore.me). The app resolves the registrable
// domain dynamically from the live host (currentBaseDomain/currentHandle below), so it runs on any
// domain; these constants are only the SSR/fallback defaults. impact reaches its A2A worker through
// the next.config `/a2a/*` rewrite (workers.dev), not a per-handle A2A subdomain.

/** Registrable Connect SSO domain — each person's home is a single-label subdomain. */
export const CONNECT_DOMAIN = 'churchcore.me';
/** Registrable A2A domain — impact has no separate A2A domain (it proxies to impact-a2a). */
export const A2A_DOMAIN = 'churchcore.me';
/** The TLD names are claimed under (the `.impact` permissionless subregistry). */
export const AGENT_NAME_PARENT = 'impact';

/** Same-origin proxies to the live agenticprimitives backends (next.config rewrites).
 *  /a2a → impact-a2a (relayer + custody bridge + vault proxy); /mcp-bind → impact-mcp. */
export const BACKEND = {
  a2a: '/a2a',
  mcpBind: '/mcp-bind',
} as const;

// ── Dynamic per-deployment domain (works on churchcore.me or any host) ──
// A person's home lives on a single-label subdomain `<handle>.<registrable-domain>`,
// and passkeys bind to that host — so connecting a named home means being ON its
// subdomain. These derive the registrable domain + current handle from the live host
// rather than the hardcoded CONNECT_DOMAIN, so impact runs under any domain.

/** Registrable domain of the current host = the last two dot-labels
 *  (`lbsb.churchcore.me` → `churchcore.me`; `www.churchcore.me` → `churchcore.me`). */
export function currentBaseDomain(): string {
  if (typeof window === 'undefined') return CONNECT_DOMAIN;
  const host = window.location.hostname.toLowerCase();
  const parts = host.split('.');
  return parts.length >= 2 ? parts.slice(-2).join('.') : host;
}

/** The handle this page is serving, if on a personal subdomain (`lbsb.<base>` → `lbsb`).
 *  null on the apex, on `www`, or on localhost. */
export function currentHandle(): string | null {
  if (typeof window === 'undefined') return null;
  const host = window.location.hostname.toLowerCase();
  if (host === 'localhost' || /^[0-9.]+$/.test(host)) return null;
  const parts = host.split('.');
  if (parts.length < 3) return null;
  const first = parts[0];
  return !first || first === 'www' ? null : first;
}

/** Origin of a handle's home on the CURRENT registrable domain (for the subdomain switch). */
export function homeOrigin(label: string): string {
  return `https://${label}.${currentBaseDomain()}`;
}

/** Alias kept for existing imports. */
export const CENTRAL_AUTH_DOMAIN = CONNECT_DOMAIN;
/** Platform (apex) Connect origin — landing + bootstrap default. */
export const PLATFORM_AUTH_ORIGIN = `https://${CONNECT_DOMAIN}`;

/** Single-label subdomain of `baseDomain` (alice.churchcore.me → alice). The
 *  apex, nested labels, `www`, and non-matching hosts → null. */
export function parseAgentSubdomain(hostname: string, baseDomain: string = CONNECT_DOMAIN): string | null {
  const host = (hostname.split(':')[0] ?? '').toLowerCase();
  const base = baseDomain.toLowerCase();
  if (host === base) return null;
  if (!host.endsWith('.' + base)) return null;
  const label = host.slice(0, host.length - base.length - 1);
  if (!label || label.includes('.') || label === 'www') return null;
  return label;
}

/** The handle this page serves on a personal subdomain, else null (apex / pages.dev / localhost). */
export function subdomainHandle(): string | null {
  if (typeof window === 'undefined') return null;
  return parseAgentSubdomain(window.location.hostname);
}

/** Personal SSO origin for a label (alice → https://alice.churchcore.me). */
export function personalAuthOrigin(label: string): string {
  return `https://${label}.${CONNECT_DOMAIN}`;
}

/** The `.agent` name for a label (alice → alice.demo.agent). */
export function agentNameForLabel(label: string): string {
  return `${label}.${AGENT_NAME_PARENT}`;
}

/** The label of a name (alice.demo.agent → alice; alice → alice). */
export function nameLabel(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(new RegExp(`\\.${AGENT_NAME_PARENT.replace(/\./g, '\\.')}$`), '')
      .replace(/\.+$/, '')
      .split('.')[0] ?? ''
  );
}

/** Normalize any name/label to its full `<label>.demo.agent` form. */
export function toAgentName(nameOrLabel: string): string {
  const n = nameOrLabel.trim().toLowerCase();
  return n.endsWith(`.${AGENT_NAME_PARENT}`) ? n : `${nameLabel(n)}.${AGENT_NAME_PARENT}`;
}
