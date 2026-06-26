"use client";

import { useState } from "react";
import Link from "next/link";
import { useSession } from "@/context/session";
import { orgById } from "@/lib/seed";
import { SectionHead, StatTile, Pill, EmptyNote } from "@/components/ui";
import { IconWallet, IconGift } from "@/components/Icons";
import { useAgentBalances, usePersonTreasury, useOrgTreasury, type TreasuryInfo } from "@/lib/use-live";
import { createPersonTreasury, createOrgTreasury, fundTreasury } from "@/lib/connect";
import { orgDisplay } from "@/lib/org-name";
import type { Treasury } from "@/lib/types";

const EXPLORER = "https://sepolia.basescan.org/address/";

export default function TreasuryPage() {
  const { person, active, identity, token } = useSession();
  const isOrg = active.mode === "org";
  const liveOrg = active.mode === "org" ? active.live : undefined;
  const via = identity?.via ?? "passkey";
  const deployed = !!identity?.deployed;
  const [refreshKey, setRefreshKey] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [actErr, setActErr] = useState<string | null>(null);
  const [fundAmt, setFundAmt] = useState("25");

  // Person money agent (person vault) + ORG money agent (org vault) — each a separate Smart Agent
  // detected from its OWNER's relationship record, with its live on-chain balance.
  const treas = usePersonTreasury(!isOrg, refreshKey);
  const orgTreas = useOrgTreasury(liveOrg, refreshKey);
  const selfBal = useAgentBalances(!isOrg ? person?.address : undefined); // person fallback only
  if (!person) return null;

  const seedOrg = isOrg && !liveOrg ? orgById(active.orgId) : undefined; // seeded demo org
  const seedTreasury: Treasury | undefined = seedOrg?.treasury;

  // The treasury for the active context. Person + live org are VAULT-detected; a seeded org uses seed.
  const cur: TreasuryInfo | null = liveOrg ? orgTreas : !isOrg ? treas : null;
  const ownerName = liveOrg ? orgDisplay(liveOrg.address, liveOrg.name) : isOrg ? seedOrg?.name : person.name;
  const canManage = deployed && !busy && (!!liveOrg || !isOrg);          // person or live-org custodian
  const showCreate = !!cur && !cur.loading && !cur.exists;               // no treasury agent yet

  const treasuryAddr = cur ? (cur.exists ? cur.address : null) : seedTreasury?.address;
  const treasuryName = cur ? (cur.name ?? (liveOrg ? "Organization treasury" : "Your money agent")) : seedOrg?.agentName;
  const balanceLabel = cur
    ? cur.loading ? "…" : `$${(cur.exists ? cur.usdc : "0.00") ?? "0.00"}`
    : `$${(seedTreasury?.balanceUsdc ?? 0).toLocaleString()}`;

  const mandates = seedTreasury?.mandates ?? [];
  const subscriptions = mandates.filter((m) => m.kind === "subscription");
  const payg = mandates.filter((m) => m.kind === "pay-as-you-go");

  async function onCreate() {
    if (!person) return;
    setActErr(null);
    const out = liveOrg
      ? liveOrg.stewardship
        ? await createOrgTreasury({ name: liveOrg.name ?? null, orgSA: liveOrg.address, orgStewardship: liveOrg.stewardship, personSA: person.address, via, token: token ?? undefined }, setBusy)
        : { ok: false as const, error: "This org's stewardship grant isn't loaded — re-enter it from Organizations." }
      : await createPersonTreasury({ name: identity?.name ?? null, personSA: person.address, via, token: token ?? undefined }, setBusy);
    setBusy(null);
    if (out.ok) { setRefreshKey((k) => k + 1); if (out.warning) setActErr(out.warning); } else setActErr(out.error);
  }
  async function onFund() {
    if (!person) return;
    const target = liveOrg ? orgTreas.address : treas.exists && treas.address ? treas.address : person.address;
    if (!target) { setActErr("No treasury to fund yet — create it first."); return; }
    const amt = Number(fundAmt);
    if (!(amt > 0)) { setActErr("Enter an amount greater than 0."); return; }
    setActErr(null);
    // The person SA mints mock USDC into the treasury (custodian mint — no held faucet key).
    const out = await fundTreasury({ treasury: target, usdc: amt, personSA: person.address, via, token: token ?? undefined }, setBusy);
    setBusy(null);
    if (out.ok) setRefreshKey((k) => k + 1); else setActErr(out.error);
  }

  // Fund control shows once a treasury exists (person or live org), for the custodian.
  const fundControl = canManage && cur?.exists ? (
    <div className="row" style={{ gap: ".4rem" }}>
      <input
        value={fundAmt} onChange={(e) => setFundAmt(e.target.value)} inputMode="decimal" aria-label="USDC amount"
        style={{ width: 72, padding: ".4rem .55rem", borderRadius: "var(--r-sm)", border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--ink)", fontFamily: "inherit" }}
      />
      <button className="btn btn-primary btn-sm" onClick={onFund} disabled={!canManage}>
        <IconGift width={15} height={15} /> {busy ? "…" : "Fund USDC"}
      </button>
    </div>
  ) : undefined;

  return (
    <>
      <SectionHead
        eyebrow={isOrg ? "Organization treasury" : "Your treasury"}
        title="Treasury"
        sub={`Funds and giving ${ownerName ? `for ${ownerName}` : ""} — its own Smart Agent, associated through a stewardship grant in the ${liveOrg ? "organization's" : "owner's"} vault. No service holds its key.`}
        action={fundControl}
      />

      {(busy || actErr) && (
        <div className="muted" style={{ marginBottom: "1rem", color: actErr ? "var(--danger)" : undefined }}>
          {actErr ?? busy}
        </div>
      )}

      {showCreate ? (
        <div className="card card-pad" style={{ marginBottom: "1.4rem" }}>
          <EmptyNote>
            {liveOrg
              ? <>No treasury for {ownerName} yet. Its money agent is a SEPARATE Smart Agent stewarded by the org (a stewardship grant treasury→org recorded in the org&apos;s vault) — create it to fund and give on the org&apos;s terms.</>
              : <>No personal treasury yet. Your money agent is a separate Smart Agent{identity?.name ? <> (<code className="mono">{person.handle}-treasury.impact</code>)</> : <> — created nameless (its address is its id; you can name it later)</>} — create it to start giving and paying on your terms.</>}
          </EmptyNote>
          {!deployed ? (
            <p className="muted" style={{ marginTop: ".8rem" }}>
              First secure your home on-chain — go to <Link href="/account">Account → Secure my home</Link>, then create the treasury.
            </p>
          ) : (
            <button className="btn btn-primary btn-sm" style={{ marginTop: ".9rem" }} onClick={onCreate} disabled={!canManage}>
              <IconWallet width={15} height={15} /> {busy ? busy : liveOrg ? "Create org treasury" : "Create my treasury"}
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: "1.4rem" }}>
            <StatTile num={balanceLabel} label="Balance USDC (live)" accent={isOrg ? "var(--emerald-700)" : "var(--amber-700)"} />
            <StatTile num={mandates.length} label="Payment mandates" />
            <StatTile num={liveOrg ? "Org" : isOrg ? "Org" : "Personal"} label="Treasury kind" />
          </div>

          <div className="card card-pad row-between" style={{ marginBottom: "1.4rem" }}>
            <div className="row" style={{ gap: ".7rem" }}>
              <div className="glyph glyph-sm" style={{ background: "var(--surface-sunken)", color: "var(--amber-700)" }}>
                <IconWallet width={16} height={16} />
              </div>
              <div>
                <div className="row wrap" style={{ gap: ".5rem" }}>
                  <strong style={{ fontSize: ".9rem" }}>{treasuryName}</strong>
                  {cur?.exists && <Pill tone="amber">{liveOrg ? "org money agent" : "your money agent"}</Pill>}
                  {liveOrg && cur?.exists && (
                    orgTreas.entitlements && orgTreas.entitlements.length > 0
                      ? <Pill tone="emerald">delegation + entitlement</Pill>
                      : <Pill tone="plum">stewardship delegation</Pill>
                  )}
                </div>
                {treasuryAddr && (
                  <a href={`${EXPLORER}${treasuryAddr}`} target="_blank" rel="noreferrer" className="addr" style={{ marginTop: 3, display: "inline-block" }}>
                    {treasuryAddr.slice(0, 10)}…{treasuryAddr.slice(-6)} · explorer ↗
                  </a>
                )}
              </div>
            </div>
            <Pill tone="emerald"><span className="dot" /> Base Sepolia</Pill>
          </div>
        </>
      )}

      <SectionHead title="Subscriptions" sub="Recurring mandates the payee redeems on schedule." />
      <div className="col" style={{ gap: ".7rem", marginBottom: "1.6rem" }}>
        {subscriptions.length === 0 && <span className="muted">No subscriptions.</span>}
        {subscriptions.map((m) => (
          <div key={m.id} className="card card-pad">
            <div className="row-between">
              <strong>{m.payee}</strong>
              <Pill tone="plum">subscription</Pill>
            </div>
            <div className="row-between" style={{ marginTop: ".6rem" }}>
              <span className="muted" style={{ fontSize: ".84rem" }}>${m.capUsdc}/{m.period} · ${m.spentUsdc} collected to date</span>
              <span className="faint" style={{ fontSize: ".76rem" }}>next {m.nextChargeAt}</span>
            </div>
          </div>
        ))}
      </div>

      <SectionHead title="Pay-as-you-go" sub="x402 mandates redeemed per call, capped." />
      <div className="col" style={{ gap: ".7rem" }}>
        {payg.length === 0 && <span className="muted">No pay-as-you-go mandates.</span>}
        {payg.map((m) => (
          <div key={m.id} className="card card-pad row-between">
            <div>
              <strong>{m.payee}</strong>
              <div className="muted" style={{ fontSize: ".82rem" }}>cap ${m.capUsdc} · ${m.spentUsdc.toFixed(2)} spent</div>
            </div>
            <Pill tone="amber">x402</Pill>
          </div>
        ))}
      </div>
    </>
  );
}
