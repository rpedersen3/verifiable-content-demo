"use client";

import { useState } from "react";
import { useSession } from "@/context/session";
import { orgById } from "@/lib/seed";
import { Glyph } from "@/components/ui";
import { IconChevron, IconCheck } from "@/components/Icons";

// Switch between acting as yourself and acting as a custodian of one of your
// organizations. A pinned default org is where you land on arrival.
export default function ContextSwitcher() {
  const { person, active, setActive, defaultOrgId, setDefaultOrg } = useSession();
  const [open, setOpen] = useState(false);
  if (!person) return null;

  const custodyOrgs = person.custodyOf.map(orgById).filter(Boolean);
  const activeOrg = active.mode === "org" ? orgById(active.orgId) : undefined;

  return (
    <div className="ctx-switch" style={{ minWidth: 220 }}>
      <button className="ctx-trigger" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {active.mode === "org" && activeOrg ? (
          <Glyph kind="org" name={activeOrg.name} size="sm" />
        ) : (
          <Glyph kind="person" name={person.name} size="sm" />
        )}
        <span className="col" style={{ gap: 0, flex: 1, minWidth: 0 }}>
          <span style={{ fontWeight: 650, fontSize: ".88rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {active.mode === "org" && activeOrg ? activeOrg.name : person.name}
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
            <div className="nav-group-label" style={{ padding: ".3rem .55rem" }}>Act as</div>
            <button
              className={`ctx-opt ${active.mode === "person" ? "active" : ""}`}
              onClick={() => { setActive({ mode: "person" }); setOpen(false); }}
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
                    onClick={() => { setActive({ mode: "org", orgId: o.id }); setOpen(false); }}
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

            <div className="hr" style={{ margin: ".4rem 0" }} />
            <button
              className="ctx-opt"
              onClick={() => { setDefaultOrg(null); setActive({ mode: "person" }); setOpen(false); }}
            >
              <span className="faint" style={{ fontSize: ".8rem", padding: "0 .3rem" }}>
                Land in my personal home (no default org)
              </span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
