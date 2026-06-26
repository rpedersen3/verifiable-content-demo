"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "@/context/session";
import { buildNav, mobileNav } from "@/components/nav";
import ContextSwitcher from "@/components/ContextSwitcher";
import { brand } from "@/whitelabel/config";
import { orgById } from "@/lib/seed";
import { IconShield } from "@/components/Icons";
import LiveStatus from "@/components/LiveStatus";
import AccountMenu from "@/components/AccountMenu";
import { usePersonOrgs } from "@/lib/use-live";
import { parseWorkspacePath } from "@/lib/workspace";
import { orgDisplay } from "@/lib/org-name";
import type { Address } from "@agenticprimitives/types";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { phase, person, identity, token, active, setActive } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  // The URL is the source of truth for the active workspace (IA phase 2). `/org/<id>/…` selects that
  // org; anything else is Personal. We resolve the org's live descriptor (stewardship etc.) from the
  // home vault and sync it into `active`, so a deep-link / refresh / new tab lands in the right scope.
  const live = usePersonOrgs(token);
  const ws = parseWorkspacePath(pathname);
  const wsOrgId = ws.kind === "org" ? ws.orgId : null;

  useEffect(() => {
    if (phase === "anon") router.replace("/");
  }, [phase, router]);

  useEffect(() => {
    if (phase !== "authed" || !person) return;
    if (!wsOrgId) {
      if (active.mode !== "person") setActive({ mode: "person" });
      return;
    }
    const idLc = wsOrgId.toLowerCase();
    const alreadyThisOrg = active.mode === "org" &&
      (active.orgId.toLowerCase() === idLc || active.live?.address.toLowerCase() === idLc);
    if (alreadyThisOrg) return;
    const liveOrg = live.orgs.find((o) => o.agent.toLowerCase() === idLc);
    if (liveOrg) {
      setActive({ mode: "org", orgId: liveOrg.agent, live: { address: liveOrg.agent, name: liveOrg.name, via: identity?.via ?? "passkey", stewardship: liveOrg.stewardship, custodian: person.address as Address } });
      return;
    }
    if (orgById(wsOrgId)) { setActive({ mode: "org", orgId: wsOrgId }); return; }
    // Unknown org id once the live list has loaded ⇒ fall back to Personal home (fail-safe).
    if (!live.loading) router.replace("/home");
  }, [phase, person, identity?.via, token, wsOrgId, live.orgs, live.loading, active, setActive, router]);

  if (phase !== "authed" || !person) {
    return (
      <div className="entry">
        <div className="muted">Opening your home…</div>
      </div>
    );
  }

  const orgName = active.mode === "org"
    ? (active.live ? orgDisplay(active.live.address, active.live.name) : orgById(active.orgId)?.name)
    : undefined;
  const groups = buildNav(active, orgName);
  const mobile = mobileNav(active);
  const isActive = (href: string) =>
    pathname === href || (href !== "/home" && pathname.startsWith(href + "/"));

  return (
    <div className="app">
      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <Link href="/home" className="row" style={{ gap: ".6rem", padding: ".3rem .5rem 1rem" }}>
          <div className="glyph glyph-sm" style={{ background: "var(--grad-amber)", color: "#1c1917" }}>
            <IconShield width={18} height={18} />
          </div>
          <div className="col" style={{ gap: 0 }}>
            <span style={{ fontWeight: 800, color: "var(--ink)" }}>{brand.name}</span>
            <span className="faint" style={{ fontSize: ".68rem" }}>agent home</span>
          </div>
        </Link>

        <nav style={{ marginTop: ".6rem" }}>
          {groups.map((g) => (
            <div key={g.label}>
              <div className="nav-group-label">{g.label}</div>
              {g.items.map((it) => {
                const Icon = it.icon;
                return (
                  <Link
                    key={it.href}
                    href={it.href}
                    className={`nav-item ${isActive(it.href) ? "active" : ""} ${it.soon ? "soon" : ""}`}
                  >
                    <Icon className="nav-icon" />
                    <span>{it.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="spacer" />
      </aside>

      {/* ── Main ── */}
      <div className="main">
        <header className="topbar">
          {/* Top-LEFT: the workspace switcher (Personal + the orgs you steward) — picks what the
              left nav is scoped to. Top-RIGHT: your person identity + admin (AccountMenu). */}
          <ContextSwitcher />
          <div className="spacer" />
          <LiveStatus />
          <AccountMenu />
        </header>
        <main className="content anim-in" key={pathname}>
          {children}
        </main>
      </div>

      {/* ── Mobile nav ── */}
      <nav className="mobile-nav">
        {mobile.map((it) => {
          const Icon = it.icon;
          return (
            <Link key={it.href} href={it.href} className={isActive(it.href) ? "active" : ""}>
              <Icon width={20} height={20} />
              <span>{it.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
