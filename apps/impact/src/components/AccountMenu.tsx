"use client";

// Topbar account menu — the person's ADMINISTRATIVE surface (the sidebar holds operational
// app features). Trigger shows the member's claimed `.impact` handle, else their friendly name
// from their vault profile (first+last), else the short address. Menu links to Profile (edit PII
// vault), Account (recovery + account), Security, and Sign out.

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Address } from "@agenticprimitives/types";
import { useSession } from "@/context/session";
import { Glyph } from "@/components/ui";
import { IconChevron, IconUser, IconKey, IconShield, IconSignOut } from "@/components/Icons";
import { cachedProfileName, fetchProfileName, setCachedProfileName, onProfileNameChange } from "@/lib/profile-name";

const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export default function AccountMenu() {
  const { identity, token, signOut } = useSession();
  const address = identity?.address;
  const [open, setOpen] = useState(false);
  const [vaultName, setVaultName] = useState<string | null>(() => (address ? cachedProfileName(address) : null));

  useEffect(() => {
    if (!address || !identity) return;
    let cancelled = false;
    setVaultName(cachedProfileName(address));
    fetchProfileName({ kind: "self", personSA: address as Address, via: identity.via, token }).then((n) => {
      if (cancelled) return;
      setVaultName(n);
      setCachedProfileName(address, n);
    });
    const off = onProfileNameChange((addr, name) => {
      if (addr.toLowerCase() === address.toLowerCase()) setVaultName(name);
    });
    return () => { cancelled = true; off(); };
  }, [address, identity, token]);

  if (!identity) return null;

  const handle = identity.name ? (identity.name.endsWith(".impact") ? identity.name : `${identity.name}.impact`) : null;
  const display = handle ?? vaultName ?? shortAddr(identity.address);
  const sub = handle ? "your home" : vaultName ? "your home" : "claim a name";

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
          <span className="faint" style={{ fontSize: ".68rem" }}>{sub}</span>
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
            {items.map(({ href, label, sub: itemSub, Icon }) => (
              <Link key={href} href={href} role="menuitem" className="ctx-opt" onClick={() => setOpen(false)} style={{ textDecoration: "none" }}>
                <Icon width={18} height={18} style={{ color: "var(--text-faint)", flex: "0 0 auto" }} />
                <span className="col" style={{ gap: 0, flex: 1 }}>
                  <span style={{ fontWeight: 600, fontSize: ".86rem", color: "var(--ink)" }}>{label}</span>
                  <span className="faint" style={{ fontSize: ".72rem" }}>{itemSub}</span>
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
