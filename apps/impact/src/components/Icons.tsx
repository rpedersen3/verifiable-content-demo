// Minimal stroke icon set (no icon-library dependency).
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;
const base = (p: P) => ({
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  ...p,
});

export const IconHome = (p: P) => (
  <svg {...base(p)}><path d="M3 11l9-8 9 8" /><path d="M5 9.5V21h14V9.5" /><path d="M9 21v-6h6v6" /></svg>
);
export const IconUser = (p: P) => (
  <svg {...base(p)}><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></svg>
);
export const IconVault = (p: P) => (
  <svg {...base(p)}><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="12" cy="12" r="3.2" /><path d="M12 8.8V7M12 17v-1.8M15.2 12H17M7 12h1.8" /></svg>
);
export const IconWallet = (p: P) => (
  <svg {...base(p)}><rect x="3" y="6" width="18" height="13" rx="2.5" /><path d="M3 9h18" /><circle cx="16.5" cy="13.5" r="1.3" /></svg>
);
export const IconShield = (p: P) => (
  <svg {...base(p)}><path d="M12 3l8 3v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z" /><path d="M9 12l2 2 4-4" /></svg>
);
export const IconGraph = (p: P) => (
  <svg {...base(p)}><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="7" r="2.5" /><circle cx="12" cy="18" r="2.5" /><path d="M8 7.2l8 .3M7 8l4.2 7.6M16.4 9l-3.6 7" /></svg>
);
export const IconOrg = (p: P) => (
  <svg {...base(p)}><path d="M4 21V7l6-3 6 3v14" /><path d="M4 21h16" /><path d="M16 11h4v10" /><path d="M8 9h0M12 9h0M8 13h0M12 13h0M8 17h0M12 17h0" /></svg>
);
export const IconBot = (p: P) => (
  <svg {...base(p)}><rect x="4" y="7" width="16" height="12" rx="3" /><path d="M12 7V4M9 13h0M15 13h0" /><path d="M2 12v3M22 12v3" /></svg>
);
export const IconActivity = (p: P) => (
  <svg {...base(p)}><path d="M3 12h4l2 6 4-14 2 8h6" /></svg>
);
export const IconSpark = (p: P) => (
  <svg {...base(p)}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18" /></svg>
);
export const IconChevron = (p: P) => (
  <svg {...base(p)}><path d="M6 9l6 6 6-6" /></svg>
);
export const IconCheck = (p: P) => (
  <svg {...base(p)}><path d="M5 12l5 5L20 6" /></svg>
);
export const IconKey = (p: P) => (
  <svg {...base(p)}><circle cx="8" cy="8" r="4" /><path d="M11 11l9 9M16 16l2-2M19 19l2-2" /></svg>
);
export const IconLink = (p: P) => (
  <svg {...base(p)}><path d="M9 15l6-6" /><path d="M10 6l1-1a4 4 0 016 6l-1 1" /><path d="M14 18l-1 1a4 4 0 01-6-6l1-1" /></svg>
);
export const IconSignOut = (p: P) => (
  <svg {...base(p)}><path d="M14 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2h6a2 2 0 002-2v-2" /><path d="M10 12h10M17 9l3 3-3 3" /></svg>
);
export const IconPlus = (p: P) => (
  <svg {...base(p)}><path d="M12 5v14M5 12h14" /></svg>
);
export const IconGift = (p: P) => (
  <svg {...base(p)}><rect x="3" y="9" width="18" height="11" rx="2" /><path d="M3 13h18M12 9v11" /><path d="M12 9C9 9 8 4 12 4s3 5 0 5" /></svg>
);
