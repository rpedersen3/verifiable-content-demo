// Workspace URL scope (IA phase 2). The address bar carries the active context so deep-links, the
// back button, and multiple tabs are all scope-correct — and you can never act on the wrong entity
// because of a hidden session flag. ORG workspaces are scoped under `/org/<orgId>/<page>`; the PERSON
// (Personal) workspace uses the clean flat routes (`/home`, `/vault`, …) — flat == you, the default.

export type WorkspaceScope = { kind: "person" } | { kind: "org"; orgId: string };

/** Derive the active workspace from the pathname. `/org/<id>/…` → that org; anything else → Personal. */
export function parseWorkspacePath(pathname: string): WorkspaceScope {
  const m = pathname.match(/^\/org\/([^/]+)(?:\/|$)/);
  if (m && m[1]) return { kind: "org", orgId: decodeURIComponent(m[1]) };
  return { kind: "person" };
}

/** Canonical URL for a page within an org workspace. */
export function orgHref(orgId: string, page: string): string {
  return `/org/${encodeURIComponent(orgId)}/${page}`;
}

/** The org workspace's landing page. */
export function orgHome(orgId: string): string {
  return orgHref(orgId, "dashboard");
}
