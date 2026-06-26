"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/context/session";
import { orgById } from "@/lib/seed";
import { Glyph } from "@/components/ui";
import { IconChevron, IconCheck, IconPlus } from "@/components/Icons";
import { usePersonOrgs } from "@/lib/use-live";
import { orgHome } from "@/lib/workspace";
import { orgDisplay, useOrgDisplay } from "@/lib/org-name";

// The WORKSPACE switcher (top-left). Picks what the left nav is scoped to: "Personal" (you) or one
// of the orgs you steward. Your person IDENTITY + admin live in the top-right AccountMenu, not here.
// A pinned default workspace is where you land on arrival.
export default function ContextSwitcher() {
  const { person, active, token, defaultOrgId, setDefaultOrg } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const live = usePersonOrgs();
  if (!person) return null;

  // Switching = navigating to the workspace's URL; the AppShell derives `active` from the path.
  const go = (href: string) => { router.push(href); setOpen(false); };
  const custodyOrgs = person.custodyOf.map(orgById).filter(Boolean);
  const activeOrg = active.mode === "org" ? orgById(active.orgId) : undefined;
  const liveActive = active.mode === "org" ? active.live : undefined;
  // Prefer the org's display name (from its vault profile) over its .impact name / address. Reactive,
  // so saving the profile updates the trigger live.
  const liveLabel = useOrgDisplay(liveActive?.address ?? "", liveActive?.name);
  const triggerName = liveActive ? liveLabel : (activeOrg ? activeOrg.name : person.name);

  return (
    <div className="ctx-switch" style={{ minWidth: 220 }}>
      <button className="ctx-trigger" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {active.mode === "org" ? (
          <Glyph kind="org" name={triggerName} size="sm" />
        ) : (
          <Glyph kind="person" name={person.name} size="sm" />
        )}
        <span className="col" style={{ gap: 0, flex: 1, minWidth: 0 }}>
          <span style={{ fontWeight: 650, fontSize: ".88rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {triggerName}
          </span>
          <span className="faint" style={{ fontSize: ".7rem" }}>
            {active.mode === "org" ? "acting as custodian" : "acting as you"}
          </span>
        </span>
        <IconChevron width={16} height={16} style={{ color: "var(--text-faint)" }} />
      </button>

      {open && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 30 }}
            onClick={() => setOpen(false)}
          />
          <div className="ctx-menu anim-in">
            <div className="nav-group-label" style={{ padding: ".3rem .55rem" }}>Switch workspace</div>
            <button
              className={`ctx-opt ${active.mode === "person" ? "active" : ""}`}
              onClick={() => go("/home")}
            >
              <Glyph kind="person" name={person.name} size="sm" />
              <span className="col" style={{ gap: 0, flex: 1 }}>
                <span style={{ fontWeight: 600, fontSize: ".86rem" }}>{person.name}</span>
                <span className="faint" style={{ fontSize: ".72rem" }}>your personal home</span>
              </span>
              {active.mode === "person" && <IconCheck width={16} height={16} style={{ color: "var(--amber-600)" }} />}
            </button>

            {custodyOrgs.length > 0 && (
              <div className="nav-group-label" style={{ padding: ".5rem .55rem .2rem" }}>
                Organizations you steward
              </div>
            )}
            {custodyOrgs.map((o) => {
              if (!o) return null;
              const isActive = active.mode === "org" && active.orgId === o.id;
              const isDefault = defaultOrgId === o.id;
              return (
                <div key={o.id} className={`ctx-opt ${isActive ? "active" : ""}`} style={{ alignItems: "center" }}>
                  <button
                    className="row"
                    style={{ background: "transparent", border: 0, flex: 1, textAlign: "left", padding: 0 }}
                    onClick={() => go(orgHome(o.id))}
                  >
                    <Glyph kind="org" name={o.name} size="sm" />
                    <span className="col" style={{ gap: 0, flex: 1 }}>
                      <span style={{ fontWeight: 600, fontSize: ".86rem" }}>{o.name}</span>
                      <span className="faint" style={{ fontSize: ".72rem" }}>{o.profile.sector}</span>
                    </span>
                  </button>
                  <button
                    className="chip"
                    style={{ cursor: "pointer" }}
                    title={isDefault ? "This is your default" : "Set as default landing context"}
                    onClick={() => setDefaultOrg(isDefault ? null : o.id)}
                  >
                    {isDefault ? "★ default" : "set default"}
                  </button>
                </div>
              );
            })}

            {live.orgs.length > 0 && (
              <div className="nav-group-label" style={{ padding: ".5rem .55rem .2rem" }}>
                Organizations you created
              </div>
            )}
            {live.orgs.map((o) => {
              const name = orgDisplay(o.agent, o.name);
              const isActive = active.mode === "org" && active.live?.address.toLowerCase() === o.agent.toLowerCase();
              return (
                <button
                  key={o.agent}
                  className={`ctx-opt ${isActive ? "active" : ""}`}
                  onClick={() => go(orgHome(o.agent))}
                >
                  <Glyph kind="org" name={name} size="sm" />
                  <span className="col" style={{ gap: 0, flex: 1 }}>
                    <span style={{ fontWeight: 600, fontSize: ".86rem" }}>{name}</span>
                    <span className="faint" style={{ fontSize: ".72rem" }}>live · on-chain</span>
                  </span>
                  {isActive && <IconCheck width={16} height={16} style={{ color: "var(--amber-600)" }} />}
                </button>
              );
            })}

            <div className="hr" style={{ margin: ".4rem 0" }} />
            <button
              className="ctx-opt"
              onClick={() => go("/organizations")}
            >
              <IconPlus width={15} height={15} style={{ color: "var(--amber-700)" }} />
              <span style={{ fontSize: ".84rem", padding: "0 .2rem", color: "var(--amber-700)", fontWeight: 600 }}>
                Connect or create an organization
              </span>
            </button>
            <button
              className="ctx-opt"
              onClick={() => { setDefaultOrg(null); go("/home"); }}
            >
              <span className="faint" style={{ fontSize: ".8rem", padding: "0 .3rem" }}>
                Make Personal my default workspace
              </span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
