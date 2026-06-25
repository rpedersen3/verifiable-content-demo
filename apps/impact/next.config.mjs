/** @type {import('next').NextConfig} */

// Impact talks to its OWN backend workers (apps/impact-a2a + apps/impact-mcp — copies of
// the agenticprimitives impact-a2a/impact-mcp) for all real ceremonies (delegation signing,
// vault read/write, KMS custody, x402). Production deployments SHOULD set these env vars
// explicitly; the fallbacks are solo-dev convenience only.
const IMPACT_A2A_URL = process.env.IMPACT_A2A_URL || 'https://impact-a2a-production.richardpedersen3.workers.dev';
const IMPACT_MCP_URL = process.env.IMPACT_MCP_URL || 'https://impact-mcp-production.richardpedersen3.workers.dev';

// Security headers baseline (mirrors demo-sso-next). A strict CSP lands once the
// ceremony wiring is in place.
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
];

const nextConfig = {
  reactStrictMode: true,
  // The @agenticprimitives connect/auth packages ship ESM; transpile them so Next
  // bundles them consistently across server routes + client (same as demo-sso-next).
  transpilePackages: [
    "@agenticprimitives/types",
    "@agenticprimitives/connect",
    "@agenticprimitives/connect-auth",
    "@agenticprimitives/agent-account",
    "@agenticprimitives/agent-naming",
    "@agenticprimitives/identity-directory",
    "@agenticprimitives/identity-directory-adapters",
  ],
  // Pin the monorepo root for file-tracing (a stray ~/package-lock.json otherwise
  // confuses Next's workspace-root inference).
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
  async rewrites() {
    return [
      // Relayer / A2A ceremonies → impact-a2a (strip the /a2a prefix).
      { source: '/a2a/:path*', destination: `${IMPACT_A2A_URL}/:path*` },
      // Vault-key bind ceremony → impact-mcp (server-side proxy; dodges CORS on /bind).
      { source: '/mcp-bind/:path*', destination: `${IMPACT_MCP_URL}/:path*` },
    ];
  },
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
};

export default nextConfig;
