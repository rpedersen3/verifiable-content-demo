"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "@/context/session";
import { SectionHead, Pill, classBadge, EmptyNote } from "@/components/ui";
import { IconVault, IconLink, IconCheck } from "@/components/Icons";
import {
  loadImpactProfile, PROFILE_FIELDS, VaultKeyUnauthorizedError, type ImpactContactProfile,
} from "@/lib/profile-store";
import { displayNameFromContact } from "@/lib/profile-name";

type Tab = "records" | "entitlements" | "delegations";

export default function VaultPage() {
  const { person, identity } = useSession();
  const [tab, setTab] = useState<Tab>("records");

  const address = identity?.address;
  const [contact, setContact] = useState<ImpactContactProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsVaultKey, setNeedsVaultKey] = useState(false);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    setLoading(true); setNeedsVaultKey(false);
    loadImpactProfile(address as `0x${string}`)
      .then((p) => { if (!cancelled) setContact(p.contact ?? {}); })
      .catch((err) => { if (!cancelled && err instanceof VaultKeyUnauthorizedError) setNeedsVaultKey(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [address]);

  if (!person) return null;

  // Build the real records list: the encrypted community-profile record (if it holds anything) +
  // any seeded records. The profile is the member's PII vault record (spec 278 `vault:impact-profile`).
  const filled = contact ? PROFILE_FIELDS.filter((f) => ((contact[f.key] ?? "") as string).trim()) : [];
  const records: { type: string; label: string; class: string; summary: string; href?: string }[] = [];
  if (filled.length > 0) {
    records.push({
      type: "vault:impact-profile",
      label: "Community profile",
      class: "sensitive",
      summary: `${displayNameFromContact(contact ?? undefined) ?? "Your contact details"} · ${filled.length} field${filled.length === 1 ? "" : "s"} (${filled.map((f) => f.label.toLowerCase()).join(", ")})`,
      href: "/profile",
    });
  }
  records.push(...person.vaultRecords.map((r) => ({ type: r.type, label: r.label, class: r.class, summary: r.summary })));

  return (
    <>
      <SectionHead
        eyebrow="Your vault"
        title="Vault"
        sub="Everything you hold — your PII profile, entitlements, and delegations — gated by you and read only through a delegation."
      />

      <div className="row wrap" style={{ gap: ".5rem", marginBottom: "1.2rem" }}>
        <TabBtn active={tab === "records"} onClick={() => setTab("records")}>Records ({records.length})</TabBtn>
        <TabBtn active={tab === "entitlements"} onClick={() => setTab("entitlements")}>Entitlements ({person.entitlements.length})</TabBtn>
        <TabBtn active={tab === "delegations"} onClick={() => setTab("delegations")}>Delegations ({person.delegations.length})</TabBtn>
      </div>

      {tab === "records" && (
        needsVaultKey ? (
          <EmptyNote>
            Your vault isn&apos;t activated yet. Go to <Link href="/account">Account → Activate vault key</Link> to
            store and read your encrypted PII profile and records.
          </EmptyNote>
        ) : loading && records.length === 0 ? (
          <div className="muted">Reading your encrypted vault…</div>
        ) : records.length === 0 ? (
          <EmptyNote>Your vault is empty so far — fill in your <Link href="/profile">profile</Link> and it&apos;s sealed here under your own key.</EmptyNote>
        ) : (
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
            {records.map((r) => {
              const inner = (
                <div className="card card-pad card-hover" style={{ height: "100%" }}>
                  <div className="row-between">
                    <div className="row" style={{ gap: ".6rem" }}>
                      <div className="glyph glyph-sm" style={{ background: "var(--surface-sunken)", color: "var(--amber-700)" }}>
                        <IconVault width={16} height={16} />
                      </div>
                      <strong style={{ fontSize: ".92rem" }}>{r.label}</strong>
                    </div>
                    {classBadge(r.class)}
                  </div>
                  <div className="muted" style={{ fontSize: ".82rem", marginTop: ".6rem" }}>{r.summary}</div>
                  <div className="row-between" style={{ marginTop: ".7rem" }}>
                    <code className="mono faint" style={{ fontSize: ".72rem" }}>{r.type}</code>
                    <span className="faint" style={{ fontSize: ".72rem" }}>{r.href ? "edit →" : "encrypted"}</span>
                  </div>
                </div>
              );
              return r.href
                ? <Link key={r.type} href={r.href} style={{ textDecoration: "none", color: "inherit" }}>{inner}</Link>
                : <div key={r.type}>{inner}</div>;
            })}
          </div>
        )
      )}

      {tab === "entitlements" && (
        <div className="col" style={{ gap: ".7rem" }}>
          {person.entitlements.length === 0 && <EmptyNote>No entitlements yet — credentials an organization or service grants you will appear here.</EmptyNote>}
          {person.entitlements.map((e) => (
            <div key={e.id} className="card card-pad row-between" style={{ alignItems: "flex-start" }}>
              <div>
                <div className="row" style={{ gap: ".5rem" }}>
                  <strong>{e.title}</strong>
                  <Pill tone={e.status === "active" ? "emerald" : e.status === "pending" ? "amber" : "danger"}>{e.status}</Pill>
                </div>
                <div className="muted" style={{ fontSize: ".84rem", marginTop: 3 }}>{e.scope}</div>
                <div className="faint" style={{ fontSize: ".74rem", marginTop: 4 }}>
                  Issued by {e.issuer} · {e.grantedAt}{e.expiresAt ? ` · expires ${e.expiresAt}` : ""}
                </div>
              </div>
              <span className="chip chip-emerald"><IconCheck width={13} height={13} /> verifiable</span>
            </div>
          ))}
        </div>
      )}

      {tab === "delegations" && (
        <div className="col" style={{ gap: ".7rem" }}>
          {person.delegations.length === 0 && <EmptyNote>No delegations yet — authority you grant to (or receive from) other agents will appear here.</EmptyNote>}
          {person.delegations.map((d) => (
            <div key={d.id} className="card card-pad">
              <div className="row-between">
                <div className="row" style={{ gap: ".5rem" }}>
                  <IconLink width={16} height={16} style={{ color: "var(--plum-600)" }} />
                  <strong>{d.counterparty}</strong>
                  <Pill tone={d.direction === "given" ? "amber" : "plum"}>{d.direction === "given" ? "you → them" : "them → you"}</Pill>
                </div>
                {d.valueCapUsdc > 0 && <Pill tone="emerald">cap ${d.valueCapUsdc}</Pill>}
              </div>
              <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: ".6rem", marginTop: ".7rem" }}>
                <div>
                  <div className="eyebrow" style={{ color: "var(--emerald-700)" }}>Can do</div>
                  <ul style={{ margin: ".3rem 0 0", paddingLeft: "1.1rem", fontSize: ".84rem" }}>
                    {d.canDo.map((c) => <li key={c}>{c}</li>)}
                  </ul>
                </div>
                <div>
                  <div className="eyebrow" style={{ color: "var(--danger)" }}>Cannot do</div>
                  <ul style={{ margin: ".3rem 0 0", paddingLeft: "1.1rem", fontSize: ".84rem" }}>
                    {d.cannotDo.map((c) => <li key={c}>{c}</li>)}
                  </ul>
                </div>
              </div>
              <div className="row-between" style={{ marginTop: ".7rem" }}>
                <span className="faint" style={{ fontSize: ".74rem" }}>
                  Granted {d.grantedAt}{d.expiresAt ? ` · expires ${d.expiresAt}` : ""}
                </span>
                {d.revocable && d.direction === "given" && (
                  <button className="btn btn-danger btn-sm">Revoke</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className={`btn btn-sm ${active ? "btn-primary" : "btn-ghost"}`} onClick={onClick}>
      {children}
    </button>
  );
}
