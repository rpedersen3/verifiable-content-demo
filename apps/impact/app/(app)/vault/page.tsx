"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "@/context/session";
import { SectionHead, Pill, classBadge, EmptyNote } from "@/components/ui";
import { IconVault, IconLink, IconCheck } from "@/components/Icons";
import {
  loadImpactProfile, PROFILE_FIELDS, VaultKeyUnauthorizedError, type ImpactContactProfile,
} from "@/lib/profile-store";
import type { AccessContext } from "@/lib/access";
import { displayNameFromContact } from "@/lib/profile-name";
import { listMyOrgs, listMyReceivedDelegations, flattenDelegations, type LiveDelegation } from "@/lib/related";
import { revokeDelegation } from "@/lib/connect";
import { activateVaultKey, isVaultKeyBound } from "@/lib/vault-key";
import { loadImpactEntitlements, saveImpactEntitlements, type ImpactEntitlement } from "@/lib/entitlements-store";
import { issueOrgEntitlement, listOrgEntitlements, revokeOrgEntitlement, readOrgAsMember, type IssuedEntitlement } from "@/lib/entitlements-admin";
import type { DelegationWire } from "@/lib/delegation";
import type { ConnectVia } from "@/lib/connect";
import type { Address } from "@agenticprimitives/types";

type Tab = "records" | "entitlements" | "delegations" | "members";

export default function VaultPage() {
  const { person, identity, token, active } = useSession();
  const [tab, setTab] = useState<Tab>("records");

  // The vault SUBJECT: your own home, or — when acting as custodian of a LIVE org — that org's
  // own vault, keyed by the org SA. The whole vault stack (provision/bind/mint/read/write) is
  // owner-parameterized, so the same surfaces serve either principal; you sign as its custodian.
  const liveOrg = active.mode === "org" ? active.live : undefined;
  const isOrg = !!liveOrg;
  const address = (isOrg ? liveOrg!.address : identity?.address) as `0x${string}` | undefined;
  const via = isOrg ? liveOrg!.via : (identity?.via ?? "passkey");
  const subjectLabel = isOrg ? (liveOrg!.name ?? "this organization") : "you";

  // Access is DELEGATION-presented (custody ≠ access): self → a person→person session delegation we
  // sign; org → the org→person stewardship grant. null when we can't present one (e.g. an org whose
  // stewardship grant wasn't captured) — reads then surface as needing activation/custodianship.
  const accessCtx = useMemo<AccessContext | null>(() => {
    if (isOrg) {
      if (!liveOrg!.stewardship) return null;
      return { kind: "org", orgSA: liveOrg!.address, requester: liveOrg!.custodian, stewardship: liveOrg!.stewardship };
    }
    if (!identity?.address) return null;
    return { kind: "self", personSA: identity.address as `0x${string}`, via: identity.via, token };
  }, [isOrg, liveOrg, identity?.address, identity?.via, token]);
  const [contact, setContact] = useState<ImpactContactProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsVaultKey, setNeedsVaultKey] = useState(false);
  const [activating, setActivating] = useState<string | null>(null);
  const [activateErr, setActivateErr] = useState<string | null>(null);
  const [keyRefresh, setKeyRefresh] = useState(0);
  // Signature-free activation check first — so an inactive vault shows "activate" WITHOUT prompting a
  // signing gesture (a self read would otherwise sign a delegation just to discover it's unbound).
  const [bound, setBound] = useState<boolean | null>(null);

  // Live delegations (spec 246/247) — the person's home-managed grants + inbound grants.
  const [delegations, setDelegations] = useState<LiveDelegation[]>([]);
  const [delLoading, setDelLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [delErr, setDelErr] = useState<string | null>(null);
  const [delRefresh, setDelRefresh] = useState(0);

  useEffect(() => {
    if (!address) { setBound(null); return; }
    let cancelled = false;
    setBound(null);
    isVaultKeyBound(address).then((b) => {
      if (cancelled) return;
      setBound(b);
      if (!b) { setNeedsVaultKey(true); setEntNeedsKey(false); setLoading(false); setEntLoading(false); }
    });
    return () => { cancelled = true; };
  }, [address, keyRefresh]);

  useEffect(() => {
    if (bound !== true) return;
    if (!accessCtx) { setLoading(false); if (isOrg) setNeedsVaultKey(true); return; }
    let cancelled = false;
    setLoading(true); setNeedsVaultKey(false);
    loadImpactProfile(accessCtx)
      .then((p) => { if (!cancelled) setContact(p.contact ?? {}); })
      .catch((err) => { if (!cancelled && err instanceof VaultKeyUnauthorizedError) setNeedsVaultKey(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [bound, accessCtx, isOrg, keyRefresh]);

  /** Activate the active subject's vault key. For a live org, the connected person signs the org's
   *  VaultKeyAuthorization as its on-chain custodian (ERC-1271) — this is what gives the org a vault. */
  async function onActivateVault() {
    if (!address) return;
    setActivateErr(null); setActivating("Activating the vault…");
    const out = await activateVaultKey(address, via, token ?? undefined);
    setActivating(null);
    if (out.ok) setKeyRefresh((k) => k + 1);
    else setActivateErr(out.error);
  }

  useEffect(() => {
    if (!token) { setDelLoading(false); return; }
    let cancelled = false;
    setDelLoading(true);
    Promise.all([listMyOrgs(token), listMyReceivedDelegations(token)])
      .then(([orgs, received]) => {
        if (cancelled) return;
        const all = flattenDelegations(orgs, received);
        // In an org's vault, show only the grants that bind THIS org (e.g. the stewardship grant
        // org→you that makes you its custodian); in your own vault, show them all.
        setDelegations(isOrg && address ? all.filter((d) => d.counterpartyAddr.toLowerCase() === address.toLowerCase()) : all);
      })
      .catch(() => { if (!cancelled) setDelegations([]); })
      .finally(() => { if (!cancelled) setDelLoading(false); });
    return () => { cancelled = true; };
  }, [token, delRefresh, isOrg, address]);

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
  // Entitlements live under a SEPARATE vault resource (`vault:impact-entitlements`). A vault key
  // activated before that resource existed authorizes the profile but not entitlements — so its
  // own gate, NOT the records gate, must reflect that (a profile-only key shouldn't hide records).
  const [entNeedsKey, setEntNeedsKey] = useState(false);

  useEffect(() => {
    if (bound !== true) return; // not activated → the records gate already shows "activate"
    if (!accessCtx) { setEntLoading(false); return; }
    let cancelled = false;
    setEntLoading(true); setEntErr(null); setEntNeedsKey(false);
    loadImpactEntitlements(accessCtx)
      .then((list) => { if (!cancelled) setEntitlements(list); })
      .catch((err) => { if (!cancelled && err instanceof VaultKeyUnauthorizedError) setEntNeedsKey(true); })
      .finally(() => { if (!cancelled) setEntLoading(false); });
    return () => { cancelled = true; };
  }, [bound, accessCtx, keyRefresh]);

  async function persistEntitlements(next: ImpactEntitlement[]) {
    if (!accessCtx) return;
    setEntErr(null); setEntBusy(true);
    try {
      await saveImpactEntitlements(accessCtx, next);
      setEntitlements(next);
    } catch (err) {
      setEntErr(err instanceof VaultKeyUnauthorizedError ? "Activate the vault key first (Account → Activate vault key)." : err instanceof Error ? err.message : "save failed");
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
      issuer: addForm.issuer.trim() || (isOrg ? (liveOrg!.name ?? "This organization") : (person?.name ? person.name : "You")),
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
  // Seed sample records belong to YOUR home only — never bleed them into an org's vault.
  if (!isOrg) records.push(...person.vaultRecords.map((r) => ({ type: r.type, label: r.label, class: r.class, summary: r.summary })));

  return (
    <>
      <SectionHead
        eyebrow={isOrg ? "Organization vault" : "Your vault"}
        title="Vault"
        sub={isOrg
          ? `${liveOrg!.name ?? "This organization"}'s encrypted vault — its PII, entitlements, and delegations, keyed by the org's own Smart Agent. You read and seal it as its custodian; no service holds its key.`
          : "Everything you hold — your PII profile, entitlements, and delegations — gated by you and read only through a delegation."}
      />

      {(activating || activateErr) && (
        <div className="muted" style={{ marginBottom: "1rem", color: activateErr ? "var(--danger)" : undefined }}>
          {activateErr ?? activating}
        </div>
      )}

      <div className="row wrap" style={{ gap: ".5rem", marginBottom: "1.2rem" }}>
        <TabBtn active={tab === "records"} onClick={() => setTab("records")}>Records ({records.length})</TabBtn>
        <TabBtn active={tab === "entitlements"} onClick={() => setTab("entitlements")}>Entitlements ({entitlements.length})</TabBtn>
        <TabBtn active={tab === "delegations"} onClick={() => setTab("delegations")}>Delegations ({delegations.length})</TabBtn>
        {isOrg && <TabBtn active={tab === "members"} onClick={() => setTab("members")}>Members &amp; access</TabBtn>}
      </div>

      {tab === "members" && isOrg && (
        liveOrg!.stewardship ? (
          <MembersPanel
            orgName={liveOrg!.name ?? "this organization"}
            orgSA={liveOrg!.address}
            stewardship={liveOrg!.stewardship}
            custodian={liveOrg!.custodian}
            via={via}
            token={token}
          />
        ) : (
          <EmptyNote>This org&apos;s stewardship grant isn&apos;t loaded, so member access can&apos;t be managed here. Re-enter the org from <Link href="/organizations">Organizations</Link>.</EmptyNote>
        )
      )}

      {tab === "records" && (
        needsVaultKey ? (
          isOrg ? (
            <EmptyNote>
              <div style={{ marginBottom: ".7rem" }}>
                {liveOrg!.name ?? "This organization"} doesn&apos;t have a vault yet. As its custodian you can
                activate one — you&apos;ll sign its vault-key authorization with your own credential, and from then
                on its PII, credentials, and delegations are encrypted under the org&apos;s own key.
              </div>
              <button className="btn btn-primary btn-sm" onClick={onActivateVault} disabled={!!activating}>
                <IconVault width={15} height={15} /> {activating ? "Activating…" : "Activate this org's vault"}
              </button>
            </EmptyNote>
          ) : (
            <EmptyNote>
              Your vault isn&apos;t activated yet. Go to <Link href="/account">Account → Activate vault key</Link> to
              store and read your encrypted PII profile and records.
            </EmptyNote>
          )
        ) : loading && records.length === 0 ? (
          <div className="muted">Reading your encrypted vault…</div>
        ) : records.length === 0 ? (
          isOrg ? (
            <EmptyNote>{liveOrg!.name ?? "This organization"}&apos;s vault is active but empty so far. Record a credential under <strong>Entitlements</strong> and it&apos;s sealed here under the org&apos;s own key.</EmptyNote>
          ) : (
            <EmptyNote>Your vault is empty so far — fill in your <Link href="/profile">profile</Link> and it&apos;s sealed here under your own key.</EmptyNote>
          )
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
          isOrg ? (
            <EmptyNote>
              <div style={{ marginBottom: ".7rem" }}>{liveOrg!.name ?? "This organization"} doesn&apos;t have a vault yet — activate it to hold the org&apos;s verifiable credentials.</div>
              <button className="btn btn-primary btn-sm" onClick={onActivateVault} disabled={!!activating}>
                <IconVault width={15} height={15} /> {activating ? "Activating…" : "Activate this org's vault"}
              </button>
            </EmptyNote>
          ) : (
            <EmptyNote>
              Your vault isn&apos;t activated yet. Go to <Link href="/account">Account → Activate vault key</Link> to
              hold and read verifiable credentials in your encrypted vault.
            </EmptyNote>
          )
        ) : entNeedsKey ? (
          <EmptyNote>
            Your vault key is active for your profile but doesn&apos;t yet cover credentials. Re-run
            <Link href="/account"> Account → Activate vault key</Link> once to add the credentials resource,
            then your entitlements will read and seal here.
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

const RECORD_OPTIONS = [
  { value: "impact-profile", label: "Community profile" },
  { value: "impact-entitlements", label: "Entitlements record" },
];

/** Org-custodian surface: grant a MEMBER (a different SA) scoped read access to this org's vault via a
 *  signed entitlement — access is by the credential, NOT custody. Issue / list / revoke present the
 *  org's stewardship authority; "Test access" reads the org record AS a member you custody, proving the
 *  entitlement is the gate (revoke ⇒ the same read fails closed). */
function MembersPanel({ orgName, orgSA, stewardship, custodian, via, token }: {
  orgName: string; orgSA: Address; stewardship: DelegationWire; custodian: Address; via: ConnectVia; token: string | null;
}) {
  const auth = { stewardship, requester: custodian };
  const [issued, setIssued] = useState<IssuedEntitlement[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [form, setForm] = useState({ member: "", recordType: "impact-profile", days: "" });
  const [test, setTest] = useState<{ id: string; result: string; tone: "emerald" | "danger" } | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    listOrgEntitlements(auth)
      .then((list) => { if (alive) setIssued(list); })
      .catch(() => { if (alive) setIssued([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, orgSA]);

  async function onIssue() {
    const member = form.member.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(member)) { setErr("Enter the member's Smart Agent address (0x…)."); return; }
    if (member.toLowerCase() === orgSA.toLowerCase()) { setErr("The member must be a different agent than the org."); return; }
    setErr(null); setBusy(true);
    const days = Number(form.days);
    const out = await issueOrgEntitlement(auth, {
      member: member as Address, recordType: form.recordType,
      ...(days > 0 ? { ttlSeconds: Math.round(days * 86400) } : {}),
    });
    setBusy(false);
    if (out.ok) { setForm({ member: "", recordType: form.recordType, days: "" }); setRefresh((k) => k + 1); }
    else setErr(out.error);
  }

  async function onRevoke(id: string) {
    setErr(null); setBusy(true);
    const out = await revokeOrgEntitlement(auth, id);
    setBusy(false);
    if (out.ok) setRefresh((k) => k + 1); else setErr(out.error);
  }

  async function onTest(e: IssuedEntitlement) {
    setTest({ id: e.id, result: "Reading as the member…", tone: "emerald" });
    const out = await readOrgAsMember({ member: e.member, via, token, owner: orgSA, recordType: e.recordType });
    if (out.ok) {
      const n = out.data && typeof out.data === "object" ? Object.keys(out.data as object).length : 0;
      setTest({ id: e.id, result: `Allowed — read ${n} field group(s)${out.allowedFields ? ` (fields: ${out.allowedFields.join(", ")})` : ""}.`, tone: "emerald" });
    } else {
      setTest({ id: e.id, result: `Denied${out.reason ? ` (${out.reason})` : ""}: ${out.error}`, tone: "danger" });
    }
  }

  return (
    <div className="col" style={{ gap: ".9rem" }}>
      {err && <div className="muted" style={{ color: "var(--danger)" }}>{err}</div>}
      <div className="card card-pad col" style={{ gap: ".6rem" }}>
        <div>
          <strong style={{ fontSize: ".95rem" }}>Grant a member access</strong>
          <div className="muted" style={{ fontSize: ".83rem", marginTop: 3 }}>
            Issue {orgName} a signed entitlement so a member (a different Smart Agent) can read a scoped record
            of this org&apos;s vault — gated by the credential, never by custody. Revoke any time.
          </div>
        </div>
        <div className="row wrap" style={{ gap: ".5rem", alignItems: "center" }}>
          <input value={form.member} onChange={(e) => setForm((f) => ({ ...f, member: e.target.value }))} placeholder="Member Smart Agent (0x…)" aria-label="Member address" style={{ ...inputStyle, width: 340, fontFamily: "var(--font-mono, monospace)" }} />
          <select value={form.recordType} onChange={(e) => setForm((f) => ({ ...f, recordType: e.target.value }))} aria-label="Record" style={{ ...inputStyle, width: 190 }}>
            {RECORD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <input value={form.days} onChange={(e) => setForm((f) => ({ ...f, days: e.target.value }))} placeholder="Days (blank = no expiry)" inputMode="numeric" aria-label="Validity days" style={{ ...inputStyle, width: 150 }} />
          <button className="btn btn-primary btn-sm" onClick={onIssue} disabled={busy}>{busy ? "…" : "Issue entitlement"}</button>
        </div>
        <span className="faint" style={{ fontSize: ".72rem" }}>Tip: to see the member side, use one of your OWN agents (treasury / another org) as the member — &quot;Test access&quot; then reads as it.</span>
      </div>

      {loading && issued.length === 0 ? (
        <div className="muted">Loading issued entitlements…</div>
      ) : issued.length === 0 ? (
        <EmptyNote>No members yet. Issue an entitlement above to grant a member scoped, revocable access to this org&apos;s vault.</EmptyNote>
      ) : (
        issued.map((e) => (
          <div key={e.id} className="card card-pad">
            <div className="row-between" style={{ alignItems: "flex-start" }}>
              <div>
                <div className="row" style={{ gap: ".5rem" }}>
                  <strong>{e.recordType}</strong>
                  <Pill tone={e.status === "granted" ? "emerald" : "danger"}>{e.status}</Pill>
                </div>
                <div className="faint" style={{ fontSize: ".74rem", marginTop: 4 }}>
                  member <code className="mono">{e.member.slice(0, 8)}…{e.member.slice(-4)}</code>
                  {e.validUntil ? ` · expires ${new Date(e.validUntil).toLocaleDateString()}` : " · no expiry"}
                  {` · granted ${new Date(e.createdAt).toLocaleDateString()}`}
                </div>
              </div>
              <div className="row" style={{ gap: ".4rem" }}>
                <button className="btn btn-ghost btn-sm" onClick={() => onTest(e)} disabled={busy}>Test access</button>
                {e.status === "granted" && <button className="btn btn-danger btn-sm" onClick={() => onRevoke(e.id)} disabled={busy}>Revoke</button>}
              </div>
            </div>
            {test && test.id === e.id && (
              <div className="muted" style={{ fontSize: ".8rem", marginTop: ".6rem", color: test.tone === "danger" ? "var(--danger)" : "var(--emerald-700)" }}>
                {test.result}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
