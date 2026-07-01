// OIDC client registry (spec 230 §6). client_id → allowed redirect_uris, scopes, and
// delegation templates. Authoritative server-side gate at /oidc/authorize-grant + /oidc/grant
// + /token: redirect_uri MUST exact-match (CN-1 / open-redirect defense); the requested
// delegation_template MUST be in the client's allowed list (the template fixes the caveat set —
// the client cannot widen it); the `delegate` is taken FROM HERE, never from the request URL
// (SEC-001 anti-spoof).
//
// impact is a Personal Home that ALSO brokers for a small, fixed set of first-party demo
// relying apps (the Bible Explorer + the corpus demo). The registry is inlined (impact has no
// whitelabel `relyingApps` config); add an entry here to register a new relying app.

export interface RelyingApp {
  /** OIDC client_id the relying app sends. */
  client_id: string;
  /** Exact-match redirect allowlist (CN-1). Include the trailing slash the app sends. */
  redirect_uris: string[];
  allowed_scopes: string[];
  /** Which delegation templates the app may request. 'site-login' = value-0, time-boxed,
   *  target-scoped read delegation. Payment templates (x402-pay/subscription) are NOT enabled. */
  allowed_delegation_templates: string[];
  /** SEC-001: the authoritative delegate SA the site-login delegation binds to. The relayer
   *  re-presents this as `requester`; entitlement gating keys on the DELEGATOR (person SA). */
  delegate: `0x${string}`;
}

// The shared demo delegate address the relayer re-presents on each vault read. The app never
// signs — the home constrains via caveats, and entitlement gates on the delegator (person SA).
const DEMO_DELEGATE = '0x89D13c596c45E4eE80Af5ae06C727FE9A820ffD0' as const;

const RELYING_APPS: RelyingApp[] = [
  {
    client_id: 'bible-explorer',
    redirect_uris: [
      'https://demo-bible-ontology-production.richardpedersen3.workers.dev/',
      'http://localhost:8795/',
    ],
    allowed_scopes: ['openid', 'agent'],
    allowed_delegation_templates: ['site-login'],
    delegate: DEMO_DELEGATE,
  },
  {
    client_id: 'demo-corpus',
    redirect_uris: [
      'https://demo-corpus.richardpedersen3.workers.dev/',
      'https://demo-corpus-production.richardpedersen3.workers.dev/',
      'http://localhost:8796/',
    ],
    allowed_scopes: ['openid', 'agent'],
    allowed_delegation_templates: ['site-login'],
    delegate: DEMO_DELEGATE,
  },
];

export type OidcClient = RelyingApp;

const CLIENTS: Record<string, OidcClient> = Object.fromEntries(
  RELYING_APPS.map((c) => [c.client_id, c]),
);

export function getClient(clientId: string): OidcClient | null {
  return CLIENTS[clientId] ?? null;
}

/** Exact-match redirect allowlist (CN-1). Never substring/prefix. */
export function clientAllowsRedirect(client: OidcClient, redirectUri: string): boolean {
  return client.redirect_uris.includes(redirectUri);
}

export function clientAllowsTemplate(client: OidcClient, template: string): boolean {
  return client.allowed_delegation_templates.includes(template);
}

/** SEC-001: the registry IS the authoritative source for the delegate SA. The URL-supplied
 *  `?delegate=` is an untrusted hint and is ignored in favor of this. */
export function getClientDelegate(client: OidcClient): `0x${string}` {
  return client.delegate;
}

/** SEC-005: the single source of truth for "which relying-app origins this broker trusts" —
 *  derived from `redirect_uris` so the CORS allowlist and the redirect allowlist can't drift. */
export const ALLOWED_RELYING_ORIGINS: ReadonlySet<string> = new Set(
  RELYING_APPS.flatMap((c) =>
    c.redirect_uris
      .map((u) => {
        try { return new URL(u).origin; } catch { return null; }
      })
      .filter((s): s is string => !!s),
  ),
);

/** Is `origin` the origin of a registered client's redirect_uri? (CORS allowlist for the
 *  cross-origin OIDC endpoints — /token, /jwks — called by the relying-site SPA.) */
export function isAllowedClientOrigin(origin: string): boolean {
  return ALLOWED_RELYING_ORIGINS.has(origin);
}

/** True iff `redirectUri`'s origin is in the derived allowlist (defense-in-depth at the grant endpoints). */
export function isAllowedRelyingOrigin(redirectUri: string): boolean {
  try {
    return ALLOWED_RELYING_ORIGINS.has(new URL(redirectUri).origin);
  } catch {
    return false;
  }
}
