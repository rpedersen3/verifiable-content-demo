"use client";

import { useSession } from "@/context/session";
import { orgById } from "@/lib/seed";
import { SectionHead, StatTile, Pill, EmptyNote } from "@/components/ui";
import { IconWallet, IconGift } from "@/components/Icons";
import { useAgentBalances, usePersonTreasury } from "@/lib/use-live";
import type { Treasury } from "@/lib/types";

const EXPLORER = "https://sepolia.basescan.org/address/";

export default function TreasuryPage() {
  const { person, active } = useSession();
  const isOrg = active.mode === "org";
  // The person's money agent is `<handle>-treasury.impact` — detected live via the
  // naming service (same convention demo-sso-next uses), with its on-chain balance.
  const treas = usePersonTreasury(isOrg ? null : person?.handle);
  // Fallback: the person SA's own balance, used only if there's no treasury agent yet.
  const selfBal = useAgentBalances(isOrg ? undefined : person?.address);
  if (!person) return null;

  const org = isOrg ? orgById(active.orgId) : undefined;
  const orgTreasury: Treasury | undefined = isOrg ? org?.treasury : undefined;

  const ownerName = isOrg ? org?.name : person.name;

  // Resolve the displayed treasury (address, balance, label) for the active context.
  const treasuryAddr = isOrg ? orgTreasury?.address : treas.exists ? treas.address : person.address;
  const treasuryName = isOrg ? org?.agentName : treas.exists ? treas.name : person.agentName;
  const balanceLabel = isOrg
    ? `$${(orgTreasury?.balanceUsdc ?? 0).toLocaleString()}`
    : treas.loading || selfBal.loading
      ? "…"
      : `$${(treas.exists ? treas.usdc : selfBal.usdc) ?? "0.00"}`;

  const mandates = orgTreasury?.mandates ?? [];
  const subscriptions = mandates.filter((m) => m.kind === "subscription");
  const payg = mandates.filter((m) => m.kind === "pay-as-you-go");

  return (
    <>
      <SectionHead
        eyebrow={isOrg ? "Organization treasury" : "Your treasury"}
        title="Treasury"
        sub={`Funds and giving ${ownerName ? `for ${ownerName}` : ""} — stewarded transparently, on your terms. No service holds your key.`}
        action={<button className="btn btn-primary btn-sm"><IconGift width={15} height={15} /> Fund with USDC</button>}
      />

      {/* Personal treasury detection */}
      {!isOrg && !treas.loading && !treas.exists ? (
        <EmptyNote>
          No personal treasury yet. Your money agent is a separate Smart Agent
          (<code className="mono">{person.handle}-treasury.impact</code>) — fund or create it to start giving and paying on your terms.
        </EmptyNote>
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
