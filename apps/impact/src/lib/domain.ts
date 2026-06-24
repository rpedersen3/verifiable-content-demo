// Deployment-domain config for Impact (mirrors demo-sso-next's ADR-0021 pattern).
// The human SSO home is `<handle>.impact-agent.me`; the agent's A2A endpoint is a
// separate domain `<handle>.impact-agent.io` (served by the live demo-a2a Worker).
// Names live under the `.impact` permissionless subregistry.

export const CONNECT_DOMAIN = "impact-agent.me";
export const A2A_DOMAIN = "impact-agent.io";
export const AGENT_NAME_PARENT = "impact";
export const PLATFORM_AUTH_ORIGIN = `https://${CONNECT_DOMAIN}`;

/** The live agenticprimitives backends these UIs talk to (proxied via next rewrites). */
export const BACKEND = {
  /** same-origin proxy → demo-a2a (relayer + custody bridge + vault proxy). */
  a2a: "/a2a",
  /** same-origin proxy → demo-mcp (vault-key bind ceremony). */
  mcpBind: "/mcp-bind",
} as const;

/** alice → alice.impact-agent.me */
export function personalAuthOrigin(label: string): string {
  return `https://${label}.${CONNECT_DOMAIN}`;
}

/** alice → alice.impact */
export function agentNameForLabel(label: string): string {
  return `${label}.${AGENT_NAME_PARENT}`;
}

/** alice.impact → alice ; alice → alice */
export function nameLabel(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(new RegExp(`\\.${AGENT_NAME_PARENT}$`), "")
      .replace(/\.+$/, "")
      .split(".")[0] ?? ""
  );
}

/** short display label (drops the .impact suffix). */
export function displayLabel(nameOrLabel: string): string {
  return nameLabel(nameOrLabel);
}
