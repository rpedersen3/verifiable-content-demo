// Impact is a standalone Personal Home — it is NOT an OIDC broker for external
// relying apps (unlike impact). So there are no registered client origins:
// the cross-origin CORS allowlist used by /jwks etc. is empty. If impact later
// brokers for relying apps, source this from a whitelabel relyingApps registry
// (see impact/src/lib/oidc-clients.ts).

/** No relying-app origins are trusted for cross-origin CORS reflection. */
export function isAllowedClientOrigin(_origin: string): boolean {
  return false;
}
