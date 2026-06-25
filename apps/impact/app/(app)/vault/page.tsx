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
import { listMyOrgs, listMyReceivedDelegations, flattenDelegations, type LiveDelegation } from "@/lib/related";
import { revokeDelegation } from "@/lib/connect";
import { loadImpactEntitlements, saveImpactEntitlements, type ImpactEntitlement } from "@/lib/entitlements-store";

type Tab = "records" | "entitlements" | "delegations";

export default function VaultPage() {
  const { person, identity, token } = useSession();
  const [tab, setTab] = useState<Tab>("records");

  const address = identity?.address;
  const via = identity?.via ?? "passkey";
  const [contact, setContact] = useState<ImpactContactProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsVaultKey, setNeedsVaultKey] = useState(false);

  // Live delegations (spec 246/247) — the person's home-managed grants + inbound grants.
  const [delegations, setDelegations] = useState<LiveDelegation[]>([]);
  const [delLoading, setDelLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [delErr, setDelErr] = useState<string | null>(null);
  const [delRefresh, setDelRefresh] = useState(0);

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

  useEffect(() => {
    if (!token) { setDelLoading(false); return; }
    let cancelled = false;
    setDelLoading(true);
    Promise.all([listMyOrgs(token), listMyReceivedDelegations(token)])
      .then(([orgs, received]) => { if (!cancelled) setDelegations(flattenDelegations(orgs, received)); })
      .catch(() => { if (!cancelled) setDelegations([]); })
      .finally(() => { if (!cancelled) setDelLoading(false); });
    return () => { cancelled = true; };
  }, [token, delRefresh]);

  async function onRevoke(d: LiveDelegation) {
    if (!d.wire) return;
    setDelErr(null); setRevoking(d.id);
    const out = await revokeDelegation({ wire: d.wire, via, token: token ?? undefined });
    setRevoking(null);
    if (out.ok) setDelRefresh((k) => k + 1);
    else setDelErr(out.error);
  }

  // Live entitlements (spec 277) — verifiable credentials sealed in the member's own vault.
  const [entitlements, setEntitlements] = useState<ImpactEntitlement[]>([]);
  const [entLoading, setEntLoading] = useState(true);
  const [entErr, setEntErr] = useState<string | null>(null);
  const [entBusy, setEntBusy] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ title: "", issuer: "", scope: "" });

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    setEntLoading(true); setEntErr(null);
    loadImpactEntitlements(address as `0x${string}`)
      .then((list) => { if (!cancelled) setEntitlements(list); })
      .catch((err) => { if (!cancelled && err instanceof VaultKeyUnauthorizedError) setNeedsVaultKey(true); })
      .finally(() => { if (!cancelled) setEntLoading(false); });
    return () => { cancelled = true; };
  }, [address]);

  async function persistEntitlements(next: ImpactEntitlement[]) {
    if (!address) return;
    setEntErr(null); setEntBusy(true);
    try {
      await saveImpactEntitlements(address as `0x${string}`, next);
      setEntitlements(next);
    } catch (err) {
      setEntErr(err instanceof VaultKeyUnauthorizedError ? "Activate your vault key first (Account → Activate vault key)." : err instanceof Error ? err.message : "save failed");
    } finally {
      setEntBusy(false);
    }
  }

  async function onAddEntitlement() {
    const title = addForm.title.trim();
    if (!title) { setEntErr("Give the credential a title."); return; }
    const ent: ImpactEntitlement = {
      id: `ent:${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}:${Date.now()}`,
      title,
      issuer: addForm.issuer.trim() || (person?.name ? person.name : "You"),
      scope: addForm.scope.trim() || "Self-recorded credential",
      status: "active",
      grantedAt: new Date().toISOString(),
      selfAsserted: !addForm.issuer.trim(),
    };
    await persistEntitlements([...entitlements, ent]);
    setAddForm({ title: "", issuer: "", scope: "" });
    setShowAdd(false);
  }

  async function onRemoveEntitlement(id: string) {
    await persistEntitlements(entitlements.filter((e) => e.id !== id));
  }

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
        <TabBtn active={tab === "entitlements"} onClick={() => setTab("entitlements")}>Entitlements ({entitlements.length})</TabBtn>
        <TabBtn active={tab === "delegations"} onClick={() => setTab("delegations")}>Delegations ({delegations.length})</TabBtn>
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
        needsVaultKey ? (
          <EmptyNote>
            Your vault isn&apos;t activated yet. Go to <Link href="/account">Account → Activate vault key</Link> to
            hold and read verifiable credentials in your encrypted vault.
          </EmptyNote>
        ) : (
          <div className="col" style={{ gap: ".7rem" }}>
            {entErr && <div className="muted" style={{ color: "var(--danger)" }}>{entErr}</div>}
            <div className="row-between">
              <span className="faint" style={{ fontSize: ".78rem" }}>Sealed in your vault under your own key — read on your terms.</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowAdd((s) => !s)} disabled={entBusy}>{showAdd ? "Cancel" : "Record a credential"}</button>
            </div>

            {showAdd && (
              <div className="card card-pad col" style={{ gap: ".55rem" }}>
                <input className="input" placeholder="Title (e.g. Member — Cornerstone Fellowship)" value={addForm.title} onChange={(e) => setAddForm((f) => ({ ...f, title: e.target.value }))} style={inputStyle} />
                <input className="input" placeholder="Issuer (leave blank if self-asserted)" value={addForm.issuer} onChange={(e) => setAddForm((f) => ({ ...f, issuer: e.target.value }))} style={inputStyle} />
                <input className="input" placeholder="Scope (what it grants)" value={addForm.scope} onChange={(e) => setAddForm((f) => ({ ...f, scope: e.target.value }))} style={inputStyle} />
                <div className="row" style={{ gap: ".4rem" }}>
                  <button className="btn btn-primary btn-sm" onClick={onAddEntitlement} disabled={entBusy}>{entBusy ? "Sealing…" : "Seal into vault"}</button>
                  <span className="faint" style={{ fontSize: ".72rem", alignSelf: "center" }}>No issuer ⇒ recorded as self-asserted (no third-party verification).</span>
                </div>
              </div>
            )}

            {entLoading && entitlements.length === 0 ? (
              <div className="muted">Reading your encrypted vault…</div>
            ) : entitlements.length === 0 ? (
              <EmptyNote>No entitlements yet — credentials an organization or service grants you appear here, sealed in your vault. You can also record one you already hold.</EmptyNote>
            ) : (
              entitlements.map((e) => (
                <div key={e.id} className="card card-pad row-between" style={{ alignItems: "flex-start" }}>
                  <div>
                    <div className="row" style={{ gap: ".5rem" }}>
                      <strong>{e.title}</strong>
                      <Pill tone={e.status === "active" ? "emerald" : e.status === "pending" ? "amber" : "danger"}>{e.status}</Pill>
                    </div>
                    <div className="muted" style={{ fontSize: ".84rem", marginTop: 3 }}>{e.scope}</div>
                    <div className="faint" style={{ fontSize: ".74rem", marginTop: 4 }}>
                      Issued by {e.issuer} · {new Date(e.grantedAt).toLocaleDateString()}{e.expiresAt ? ` · expires ${new Date(e.expiresAt).toLocaleDateString()}` : ""}
                    </div>
                  </div>
                  <div className="col" style={{ gap: ".4rem", alignItems: "flex-end" }}>
                    {e.selfAsserted
                      ? <span className="chip chip-amber">self-asserted</span>
                      : <span className="chip chip-emerald"><IconCheck width={13} height={13} /> verifiable</span>}
                    <button className="btn btn-danger btn-sm" onClick={() => onRemoveEntitlement(e.id)} disabled={entBusy}>Remove</button>
                  </div>
                </div>
              ))
            )}
          </div>
        )
      )}

      {tab === "delegations" && (
        <div className="col" style={{ gap: ".7rem" }}>
          {delErr && <div className="muted" style={{ color: "var(--danger)" }}>{delErr}</div>}
          {delLoading && delegations.length === 0 ? (
            <div className="muted">Reading your live delegations…</div>
          ) : delegations.length === 0 ? (
            <EmptyNote>No delegations yet — authority you grant to (or receive from) other agents appears here. Create your <Link href="/treasury">treasury</Link> and you&apos;ll oversee it through a stewardship delegation listed here.</EmptyNote>
          ) : (
            delegations.map((d) => (
              <div key={d.id} className="card card-pad">
                <div className="row-between">
                  <div className="row" style={{ gap: ".5rem" }}>
                    <IconLink width={16} height={16} style={{ color: "var(--plum-600)" }} />
                    <strong>{d.counterparty}</strong>
                    <Pill tone={d.direction === "given" ? "amber" : "plum"}>{d.direction === "given" ? "you → them" : "them → you"}</Pill>
                    <Pill tone="plum">{d.role}</Pill>
                  </div>
                </div>
                <div className="muted" style={{ fontSize: ".84rem", marginTop: ".55rem" }}>{d.scope}</div>
                <div className="row-between" style={{ marginTop: ".7rem" }}>
                  <span className="faint" style={{ fontSize: ".74rem" }}>
                    <code className="mono">{d.counterpartyAddr.slice(0, 10)}…{d.counterpartyAddr.slice(-6)}</code>
                    {d.grantedAt ? ` · granted ${new Date(d.grantedAt).toLocaleDateString()}` : ""}
                  </span>
                  {d.revocable && d.wire && (
                    <button className="btn btn-danger btn-sm" onClick={() => onRevoke(d)} disabled={revoking === d.id}>
                      {revoking === d.id ? "Revoking…" : "Revoke"}
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </>
  );
}

const inputStyle: React.CSSProperties = {
  padding: ".5rem .6rem", borderRadius: "var(--r-sm)", border: "1px solid var(--border-strong)",
  background: "var(--surface)", color: "var(--ink)", fontFamily: "inherit", fontSize: ".86rem", width: "100%",
};

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className={`btn btn-sm ${active ? "btn-primary" : "btn-ghost"}`} onClick={onClick}>
      {children}
    </button>
  );
}
