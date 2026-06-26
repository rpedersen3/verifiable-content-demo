"use client";

import { useState } from "react";
import Link from "next/link";
import { useSession } from "@/context/session";
import { orgById } from "@/lib/seed";
import { SectionHead, StatTile, Pill, EmptyNote } from "@/components/ui";
import { IconWallet, IconGift } from "@/components/Icons";
import { useAgentBalances, usePersonTreasury } from "@/lib/use-live";
import { createPersonTreasury, fundTreasury } from "@/lib/connect";
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
  // The person's money agent — detected live from the home vault (the canonical
  // person-treasury record written at create time), with its on-chain balance.
  const treas = usePersonTreasury(!isOrg, refreshKey);
  // Fallback: the person SA's own balance, used only if there's no treasury agent yet.
  const selfBal = useAgentBalances(isOrg && !liveOrg ? undefined : liveOrg ? liveOrg.address : person?.address);
  if (!person) return null;

  const org = isOrg && !liveOrg ? orgById(active.orgId) : undefined;
  const orgTreasury: Treasury | undefined = org?.treasury;

  const ownerName = liveOrg ? (liveOrg.name ?? "your organization") : isOrg ? org?.name : person.name;

  // Resolve the displayed treasury (address, balance, label) for the active context. A LIVE org
  // holds funds in its own Smart Agent (a dedicated org-treasury agent is a follow-on).
  const treasuryAddr = liveOrg ? liveOrg.address : isOrg ? orgTreasury?.address : treas.exists ? treas.address : person.address;
  const treasuryName = liveOrg ? (liveOrg.name ?? "Organization agent") : isOrg ? org?.agentName : treas.exists ? (treas.name ?? "Your money agent") : person.agentName;
  const balanceLabel = liveOrg
    ? (selfBal.loading ? "…" : `$${selfBal.usdc ?? "0.00"}`)
    : isOrg
      ? `$${(orgTreasury?.balanceUsdc ?? 0).toLocaleString()}`
      : treas.loading || selfBal.loading
        ? "…"
        : `$${(treas.exists ? treas.usdc : selfBal.usdc) ?? "0.00"}`;

  const mandates = orgTreasury?.mandates ?? [];
  const subscriptions = mandates.filter((m) => m.kind === "subscription");
  const payg = mandates.filter((m) => m.kind === "pay-as-you-go");

  async function onCreate() {
    if (!person) return;
    setActErr(null);
    const out = await createPersonTreasury({ name: identity?.name ?? null, personSA: person.address, via, token: token ?? undefined }, setBusy);
    setBusy(null);
    if (out.ok) setRefreshKey((k) => k + 1); else setActErr(out.error);
  }
  async function onFund() {
    if (!person) return;
    const target = treas.exists && treas.address ? treas.address : person.address;
    const amt = Number(fundAmt);
    if (!(amt > 0)) { setActErr("Enter an amount greater than 0."); return; }
    setActErr(null);
    const out = await fundTreasury({ treasury: target, usdc: amt, personSA: person.address, via, token: token ?? undefined }, setBusy);
    setBusy(null);
    if (out.ok) setRefreshKey((k) => k + 1); else setActErr(out.error);
  }

  const canAct = !isOrg && deployed && !busy;
  const fundControl = !isOrg ? (
    deployed ? (
      <div className="row" style={{ gap: ".4rem" }}>
        <input
          value={fundAmt} onChange={(e) => setFundAmt(e.target.value)} inputMode="decimal" aria-label="USDC amount"
          style={{ width: 72, padding: ".4rem .55rem", borderRadius: "var(--r-sm)", border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--ink)", fontFamily: "inherit" }}
        />
        <button className="btn btn-primary btn-sm" onClick={onFund} disabled={!canAct}>
          <IconGift width={15} height={15} /> {busy ? "…" : "Fund USDC"}
        </button>
      </div>
    ) : undefined
  ) : undefined;

  return (
    <>
      <SectionHead
        eyebrow={isOrg ? "Organization treasury" : "Your treasury"}
        title="Treasury"
        sub={`Funds and giving ${ownerName ? `for ${ownerName}` : ""} — stewarded transparently, on your terms. No service holds your key.`}
        action={fundControl}
      />

      {(busy || actErr) && (
        <div className="muted" style={{ marginBottom: "1rem", color: actErr ? "var(--danger)" : undefined }}>
          {actErr ?? busy}
        </div>
      )}

      {/* Personal treasury detection */}
      {!isOrg && !treas.loading && !treas.exists ? (
        <div className="card card-pad" style={{ marginBottom: "1.4rem" }}>
          <EmptyNote>
            No personal treasury yet. Your money agent is a separate Smart Agent
            {identity?.name
              ? <> (<code className="mono">{person.handle}-treasury.impact</code>)</>
              : <> — created nameless (its address is its id; you can name it later)</>}
            {" "}— create it to start giving and paying on your terms.
          </EmptyNote>
          {!deployed ? (
            <p className="muted" style={{ marginTop: ".8rem" }}>
              First secure your home on-chain — go to <Link href="/account">Account → Secure my home</Link>, then create your treasury.
            </p>
          ) : (
            <button className="btn btn-primary btn-sm" style={{ marginTop: ".9rem" }} onClick={onCreate} disabled={!canAct}>
              <IconWallet width={15} height={15} /> {busy ? busy : "Create my treasury"}
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: "1.4rem" }}>
            <StatTile num={balanceLabel} label="Balance USDC (live)" accent={isOrg ? "var(--emerald-700)" : "var(--amber-700)"} />
            <StatTile num={mandates.length} label="Payment mandates" />
            <StatTile num={isOrg ? "Org" : "Personal"} label="Treasury kind" />
          </div>

          <div className="card card-pad row-between" style={{ marginBottom: "1.4rem" }}>
            <div className="row" style={{ gap: ".7rem" }}>
              <div className="glyph glyph-sm" style={{ background: "var(--surface-sunken)", color: "var(--amber-700)" }}>
                <IconWallet width={16} height={16} />
              </div>
              <div>
                <div className="row" style={{ gap: ".5rem" }}>
                  <strong style={{ fontSize: ".9rem" }}>{treasuryName}</strong>
                  {!isOrg && treas.exists && <Pill tone="amber">your money agent</Pill>}
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
