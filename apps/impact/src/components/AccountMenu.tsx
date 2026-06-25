"use client";

// Topbar account menu — the person's ADMINISTRATIVE surface (the sidebar holds operational
// app features). Trigger shows the member's valid name (or short address until they claim one).
// Menu links to Profile (edit PII vault), Account (recovery + account), Security, and Sign out.

import { useState } from "react";
import Link from "next/link";
import { useSession } from "@/context/session";
import { Glyph } from "@/components/ui";
import { IconChevron, IconUser, IconKey, IconShield, IconSignOut } from "@/components/Icons";

const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export default function AccountMenu() {
  const { identity, signOut } = useSession();
  const [open, setOpen] = useState(false);
  if (!identity) return null;

  const named = !!identity.name;
  const display = named
    ? (identity.name!.endsWith(".impact") ? identity.name! : `${identity.name}.impact`)
    : shortAddr(identity.address);

  const items = [
    { href: "/profile", label: "Profile", sub: "Your details & PII vault", Icon: IconUser },
    { href: "/account", label: "Account", sub: "Recovery & account settings", Icon: IconKey },
    { href: "/security", label: "Security", sub: "Sign-in methods & devices", Icon: IconShield },
  ];

  return (
    <div className="ctx-switch" style={{ minWidth: 0 }}>
      <button className="ctx-trigger" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu" style={{ minWidth: 0 }}>
        <Glyph kind="person" name={display} size="sm" />
        <span className="col" style={{ gap: 0, minWidth: 0 }}>
          <span style={{ fontWeight: 650, fontSize: ".85rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 160 }}>
            {display}
          </span>
          <span className="faint" style={{ fontSize: ".68rem" }}>{named ? "your home" : "claim a name"}</span>
        </span>
        <IconChevron width={16} height={16} style={{ color: "var(--text-faint)" }} />
      </button>

      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 30 }} onClick={() => setOpen(false)} />
          <div className="ctx-menu anim-in" role="menu" style={{ left: "auto", right: 0, minWidth: 250 }}>
            <div className="row" style={{ gap: ".55rem", padding: ".4rem .55rem .55rem" }}>
              <Glyph kind="person" name={display} size="sm" />
              <span className="col" style={{ gap: 0, minWidth: 0 }}>
                <span style={{ fontWeight: 700, fontSize: ".88rem" }}>{display}</span>
                <span className="addr" title={identity.address}>{shortAddr(identity.address)}</span>
              </span>
            </div>
            <div className="hr" style={{ margin: ".2rem 0 .35rem" }} />
            {items.map(({ href, label, sub, Icon }) => (
              <Link key={href} href={href} role="menuitem" className="ctx-opt" onClick={() => setOpen(false)} style={{ textDecoration: "none" }}>
                <Icon width={18} height={18} style={{ color: "var(--text-faint)", flex: "0 0 auto" }} />
                <span className="col" style={{ gap: 0, flex: 1 }}>
                  <span style={{ fontWeight: 600, fontSize: ".86rem", color: "var(--ink)" }}>{label}</span>
                  <span className="faint" style={{ fontSize: ".72rem" }}>{sub}</span>
                </span>
              </Link>
            ))}
            <div className="hr" style={{ margin: ".35rem 0" }} />
            <button className="ctx-opt" role="menuitem" onClick={() => { setOpen(false); signOut(); }}>
              <IconSignOut width={18} height={18} style={{ color: "var(--danger, #b91c1c)", flex: "0 0 auto" }} />
              <span style={{ fontWeight: 600, fontSize: ".86rem", color: "var(--danger, #b91c1c)" }}>Sign out</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
