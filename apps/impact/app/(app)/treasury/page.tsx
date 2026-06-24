"use client";

import { useSession } from "@/context/session";
import { orgById } from "@/lib/seed";
import { SectionHead, StatTile, Pill } from "@/components/ui";
import { IconWallet, IconGift } from "@/components/Icons";
import { useAgentBalances } from "@/lib/use-live";
import type { Treasury } from "@/lib/types";

export default function TreasuryPage() {
  const { person, active } = useSession();
  const bal = useAgentBalances(active.mode === "org" ? undefined : person?.treasury.address);
  if (!person) return null;

  const isOrg = active.mode === "org";
  const org = isOrg ? orgById(active.orgId) : undefined;
  const treasury: Treasury | undefined = isOrg ? org?.treasury : person.treasury;
  if (!treasury) return null;

  // For your own treasury the balance is read LIVE on-chain; org (seed) keeps its figure.
  const balanceLabel = isOrg ? `$${treasury.balanceUsdc.toLocaleString()}` : bal.loading ? "…" : `$${bal.usdc ?? "0.00"}`;

  const ownerName = isOrg ? org?.name : person.name;
  const subscriptions = treasury.mandates.filter((m) => m.kind === "subscription");
  const payg = treasury.mandates.filter((m) => m.kind === "pay-as-you-go");
  const committed = treasury.mandates.reduce((s, m) => s + m.capUsdc, 0);

  return (
    <>
      <SectionHead
        eyebrow={isOrg ? "Organization treasury" : "Your treasury"}
        title="Treasury"
        sub={`Funds and standing payment mandates for ${ownerName}. No service holds your key — every charge runs against a capped, revocable delegation.`}
        action={<button className="btn btn-primary btn-sm"><IconGift width={15} height={15} /> Add funds</button>}
      />

      <div className="grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: "1.4rem" }}>
        <StatTile num={balanceLabel} label={isOrg ? "Balance (USDC)" : "Balance USDC (live)"} accent={isOrg ? "var(--emerald-700)" : "var(--amber-700)"} />
        <StatTile num={`$${committed.toLocaleString()}`} label="Committed per period" />
        <StatTile num={treasury.mandates.length} label="Active mandates" />
      </div>

      <div className="card card-pad row-between" style={{ marginBottom: "1.4rem" }}>
        <div className="row" style={{ gap: ".7rem" }}>
          <div className="glyph glyph-sm" style={{ background: "var(--surface-sunken)", color: "var(--amber-700)" }}>
            <IconWallet width={16} height={16} />
          </div>
          <div>
            <div className="faint" style={{ fontSize: ".72rem" }}>Treasury agent</div>
            <code className="mono">{treasury.address}</code>
          </div>
        </div>
        <Pill tone="emerald"><span className="dot" /> on Base Sepolia</Pill>
      </div>

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
              <span className="muted" style={{ fontSize: ".84rem" }}>
                ${m.capUsdc}/{m.period} · ${m.spentUsdc} collected to date
              </span>
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
