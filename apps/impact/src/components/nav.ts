import type { ComponentType, SVGProps } from "react";
import {
  IconHome,
  IconUser,
  IconVault,
  IconWallet,
  IconShield,
  IconGraph,
  IconOrg,
  IconBot,
  IconActivity,
  IconLink,
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

export function buildNav(active: ActiveContext, orgName?: string): NavGroup[] {
  if (active.mode === "org") {
    return [
      { label: "Overview", items: [{ href: "/home", label: "Dashboard", icon: IconHome }] },
      {
        label: orgName ?? "Organization",
        items: [
          { href: "/organization", label: "Organization", icon: IconOrg },
          { href: "/service-agents", label: "Service agents", icon: IconBot },
          { href: "/treasury", label: "Treasury", icon: IconWallet },
          { href: "/security", label: "Security", icon: IconShield },
        ],
      },
      {
        label: "Trust",
        items: [
          { href: "/trust-graph", label: "Trust graph", icon: IconGraph },
          { href: "/activity", label: "Activity", icon: IconActivity },
          { href: "/network", label: "Network", icon: IconLink },
        ],
      },
    ];
  }
  return [
    {
      label: "Your home",
      items: [
        { href: "/home", label: "Home", icon: IconHome },
        { href: "/you", label: "You", icon: IconUser },
        { href: "/vault", label: "Vault", icon: IconVault },
        { href: "/treasury", label: "Treasury", icon: IconWallet },
        { href: "/security", label: "Security", icon: IconShield },
      ],
    },
    {
      label: "Trust",
      items: [
        { href: "/trust-graph", label: "Trust graph", icon: IconGraph },
        { href: "/organizations", label: "Organizations", icon: IconOrg },
        { href: "/activity", label: "Activity", icon: IconActivity },
        { href: "/network", label: "Network", icon: IconLink },
      ],
    },
  ];
}

/** Five flat items for the mobile bottom bar (context-aware). */
export function mobileNav(active: ActiveContext): NavItem[] {
  if (active.mode === "org") {
    return [
      { href: "/home", label: "Home", icon: IconHome },
      { href: "/organization", label: "Org", icon: IconOrg },
      { href: "/service-agents", label: "Agents", icon: IconBot },
      { href: "/trust-graph", label: "Trust", icon: IconGraph },
      { href: "/treasury", label: "Treasury", icon: IconWallet },
    ];
  }
  return [
    { href: "/home", label: "Home", icon: IconHome },
    { href: "/you", label: "You", icon: IconUser },
    { href: "/vault", label: "Vault", icon: IconVault },
    { href: "/trust-graph", label: "Trust", icon: IconGraph },
    { href: "/organizations", label: "Orgs", icon: IconOrg },
  ];
}
