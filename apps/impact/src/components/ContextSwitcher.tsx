"use client";

import { useState } from "react";
import { useSession } from "@/context/session";
import { orgById } from "@/lib/seed";
import { Glyph } from "@/components/ui";
import { IconChevron, IconCheck } from "@/components/Icons";
import { usePersonOrgs } from "@/lib/use-live";

// Switch between acting as yourself and acting as a custodian of one of your
// organizations. A pinned default org is where you land on arrival.
export default function ContextSwitcher() {
  const { person, identity, token, active, setActive, defaultOrgId, setDefaultOrg } = useSession();
  const [open, setOpen] = useState(false);
  const live = usePersonOrgs(token);
  if (!person) return null;

  const via = identity?.via ?? "passkey";
  const custodyOrgs = person.custodyOf.map(orgById).filter(Boolean);
  const activeOrg = active.mode === "org" ? orgById(active.orgId) : undefined;
  const liveActive = active.mode === "org" ? active.live : undefined;
  const liveLabel = liveActive ? (liveActive.name ?? `${liveActive.address.slice(0, 6)}…${liveActive.address.slice(-4)}`) : undefined;
  const triggerName = liveLabel ?? (activeOrg ? activeOrg.name : person.name);

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

            {live.orgs.length > 0 && (
              <div className="nav-group-label" style={{ padding: ".5rem .55rem .2rem" }}>
                Organizations you created
              </div>
            )}
            {live.orgs.map((o) => {
              const name = o.name ?? `${o.agent.slice(0, 6)}…${o.agent.slice(-4)}`;
              const isActive = active.mode === "org" && active.live?.address.toLowerCase() === o.agent.toLowerCase();
              return (
                <button
                  key={o.agent}
                  className={`ctx-opt ${isActive ? "active" : ""}`}
                  onClick={() => { setActive({ mode: "org", orgId: o.agent, live: { address: o.agent, name: o.name, via, stewardship: o.stewardship, custodian: person.address } }); setOpen(false); }}
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
