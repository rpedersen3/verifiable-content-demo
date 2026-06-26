import type { ComponentType, SVGProps } from "react";
import {
  IconHome,
  IconVault,
  IconWallet,
  IconShield,
  IconGraph,
  IconOrg,
  IconBot,
  IconActivity,
} from "@/components/Icons";
import type { ActiveContext } from "@/context/session";

export interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  soon?: boolean;
}
export interface NavGroup {
  label: string;
  items: NavItem[];
}

// The left sidebar is ALWAYS scoped to the SELECTED WORKSPACE (the top-left switcher picks it):
// "Personal" (the connected person) or one of the orgs they steward. Person IDENTITY + admin
// (profile, account, security/sign-in, sign out) live in the top-RIGHT AccountMenu, never here.
// Each org is a FULL peer: its own Dashboard, Organization, Service agents, Vault (incl. Members &
// access), Treasury, Security, Trust, Activity. `/network` is a developer infra page — demoted out
// of the primary nav (still reachable by direct URL).
export function buildNav(active: ActiveContext, orgName?: string): NavGroup[] {
  if (active.mode === "org") {
    return [
      { label: "Overview", items: [{ href: "/home", label: "Dashboard", icon: IconHome }] },
      {
        label: orgName ?? "Organization",
        items: [
          { href: "/organization", label: "Organization", icon: IconOrg },
          { href: "/service-agents", label: "Service agents", icon: IconBot },
          { href: "/vault", label: "Vault", icon: IconVault },
          { href: "/treasury", label: "Treasury", icon: IconWallet },
          { href: "/security", label: "Security", icon: IconShield },
        ],
      },
      {
        label: "Trust",
        items: [
          { href: "/trust-graph", label: "Trust graph", icon: IconGraph },
          { href: "/activity", label: "Activity", icon: IconActivity },
        ],
      },
    ];
  }
  return [
    {
      label: "Your home",
      items: [
        { href: "/home", label: "Home", icon: IconHome },
        { href: "/vault", label: "Vault", icon: IconVault },
        { href: "/treasury", label: "Treasury", icon: IconWallet },
        { href: "/organizations", label: "Organizations", icon: IconOrg },
      ],
    },
    {
      label: "Trust",
      items: [
        { href: "/trust-graph", label: "Trust graph", icon: IconGraph },
        { href: "/activity", label: "Activity", icon: IconActivity },
      ],
    },
  ];
}

/** Five flat items for the mobile bottom bar (workspace-aware). The workspace switcher itself lives
 *  in the top bar; this is page nav within the selected workspace. */
export function mobileNav(active: ActiveContext): NavItem[] {
  if (active.mode === "org") {
    return [
      { href: "/home", label: "Home", icon: IconHome },
      { href: "/organization", label: "Org", icon: IconOrg },
      { href: "/service-agents", label: "Agents", icon: IconBot },
      { href: "/vault", label: "Vault", icon: IconVault },
      { href: "/treasury", label: "Treasury", icon: IconWallet },
    ];
  }
  return [
    { href: "/home", label: "Home", icon: IconHome },
    { href: "/vault", label: "Vault", icon: IconVault },
    { href: "/treasury", label: "Treasury", icon: IconWallet },
    { href: "/trust-graph", label: "Trust", icon: IconGraph },
    { href: "/organizations", label: "Orgs", icon: IconOrg },
  ];
}
