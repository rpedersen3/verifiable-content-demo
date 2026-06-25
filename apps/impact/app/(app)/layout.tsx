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

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { phase, person, active } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (phase === "anon") router.replace("/");
  }, [phase, router]);

  if (phase !== "authed" || !person) {
    return (
      <div className="entry">
        <div className="muted">Opening your home…</div>
      </div>
    );
  }

  const orgName = active.mode === "org" ? orgById(active.orgId)?.name : undefined;
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

        <ContextSwitcher />

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
