"use client";

// Live on-chain reads for the connected agent, through the same /a2a proxy the rest of
// the app uses. No vault/delegation infra needed — just real balances from Base Sepolia.
import { useEffect, useMemo, useState } from "react";
import { erc20BalanceOf, getEthBalance, formatUnits } from "./backend";
import { CONTRACTS } from "./chain";
import { listMyOrgs, cachedMyOrgs } from "./related";
import { useSession, type LiveOrgRef } from "@/context/session";
import type { AccessContext } from "./access";
import type { DelegationWire } from "./delegation";
import type { Address } from "./types";

/** The connected person's self AccessContext — used to read/write their OWN vault (relationships,
 *  profile, entitlements) over a presented session delegation. null until an identity is connected. */
export function useSelfCtx(): AccessContext | null {
  const { identity, token } = useSession();
  return useMemo<AccessContext | null>(
    () => (identity?.address ? { kind: "self", personSA: identity.address as Address, via: identity.via, token } : null),
    [identity?.address, identity?.via, token],
  );
}

export interface AgentBalances {
  usdc: string | null; // formatted, 2dp (mock USDC, 6 decimals)
  eth: string | null; // formatted, 4dp
  loading: boolean;
}

export function useAgentBalances(address?: string | null): AgentBalances {
  const [usdc, setUsdc] = useState<string | null>(null);
  const [eth, setEth] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    if (!address) { setLoading(false); return; }
    setLoading(true);
    (async () => {
      try {
        const [u, e] = await Promise.all([
          erc20BalanceOf(CONTRACTS.mockUsdc as Address, address as Address),
          getEthBalance(address as Address),
        ]);
        if (!alive) return;
        setUsdc(formatUnits(u, 6, 2));
        setEth(formatUnits(e, 18, 4));
      } catch {
        if (alive) { setUsdc(null); setEth(null); }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [address]);

  return { usdc, eth, loading };
}

export interface TreasuryInfo {
  exists: boolean;
  name: string | null;
  address: Address | null;
  usdc: string | null;
  loading: boolean;
}

/** Detect the person's treasury from their HOME VAULT — the canonical record written at create
 *  time (related-orgs, kind:'person-treasury'), NOT a naming convention. This works for NAMELESS
 *  homes/treasuries too (the SA address is the canonical id; a name is an optional facet). Reads
 *  the treasury SA's live USDC balance. Returns exists:false when the person has no treasury yet. */
export function usePersonTreasury(enabled = true, refreshKey = 0): TreasuryInfo {
  const ctx = useSelfCtx();
  const [state, setState] = useState<TreasuryInfo>({ exists: false, name: null, address: null, usdc: null, loading: true });

  useEffect(() => {
    let alive = true;
    if (!enabled || !ctx) { setState({ exists: false, name: null, address: null, usdc: null, loading: false }); return; }
    setState((s) => ({ ...s, loading: true }));
    (async () => {
      try {
        const orgs = await listMyOrgs(ctx);
        if (!alive) return;
        const treasury = orgs.find((o) => o.kind === "person-treasury");
        if (!treasury) {
          setState({ exists: false, name: null, address: null, usdc: null, loading: false });
          return;
        }
        const addr = treasury.orgAgent as Address;
        const bal = await erc20BalanceOf(CONTRACTS.mockUsdc as Address, addr);
        if (!alive) return;
        setState({ exists: true, name: treasury.orgName?.trim() || null, address: addr, usdc: formatUnits(bal, 6, 2), loading: false });
      } catch {
        if (alive) setState({ exists: false, name: null, address: null, usdc: null, loading: false });
      }
    })();
    return () => { alive = false; };
  }, [enabled, ctx, refreshKey]);

  return state;
}

/** An ORG's money agent — a separate Smart Agent recorded in the ORG'S vault (kind 'org-treasury'),
 *  read over the org→person stewardship grant. Mirrors usePersonTreasury, rooted in the org's vault. */
export function useOrgTreasury(live: LiveOrgRef | null | undefined, refreshKey = 0): TreasuryInfo {
  const ctx = useMemo<AccessContext | null>(
    () => (live && live.stewardship ? { kind: "org", orgSA: live.address, requester: live.custodian, stewardship: live.stewardship } : null),
    [live?.address, live?.custodian, live?.stewardship],
  );
  const [state, setState] = useState<TreasuryInfo>({ exists: false, name: null, address: null, usdc: null, loading: true });

  useEffect(() => {
    let alive = true;
    if (!ctx) { setState({ exists: false, name: null, address: null, usdc: null, loading: false }); return; }
    setState((s) => ({ ...s, loading: true }));
    (async () => {
      try {
        const rels = await listMyOrgs(ctx);
        if (!alive) return;
        const t = rels.find((o) => o.kind === "org-treasury");
        if (!t) { setState({ exists: false, name: null, address: null, usdc: null, loading: false }); return; }
        const addr = t.orgAgent as Address;
        const bal = await erc20BalanceOf(CONTRACTS.mockUsdc as Address, addr);
        if (!alive) return;
        setState({ exists: true, name: t.orgName?.trim() || null, address: addr, usdc: formatUnits(bal, 6, 2), loading: false });
      } catch {
        if (alive) setState({ exists: false, name: null, address: null, usdc: null, loading: false });
      }
    })();
    return () => { alive = false; };
  }, [ctx, refreshKey]);

  return state;
}

export interface LiveOrg {
  agent: Address;
  name: string | null;
  createdAt: number | null;
  /** The org→person stewardship grant — presented to read the org's vault AS its custodian. */
  stewardship: DelegationWire | null;
}

export interface LiveOrgs {
  orgs: LiveOrg[];
  loading: boolean;
}

/** The organizations the person governs, read from the person's VAULT (vault:impact-relationships,
 *  kind 'org'). Renders the local cache instantly, then refreshes from the vault. Live, not seeded. */
export function usePersonOrgs(refreshKey = 0): LiveOrgs {
  const ctx = useSelfCtx();
  const personSA = ctx?.kind === "self" ? ctx.personSA : null;
  const toLive = (mine: { orgAgent: string; orgName: string; createdAt: number | null; kind?: string; stewardshipDelegation?: DelegationWire | null }[]): LiveOrg[] =>
    mine.filter((o) => o.kind === "org").map((o) => ({ agent: o.orgAgent as Address, name: o.orgName?.trim() || null, createdAt: o.createdAt, stewardship: o.stewardshipDelegation ?? null }));

  const [state, setState] = useState<LiveOrgs>(() => ({ orgs: personSA ? toLive(cachedMyOrgs(personSA)) : [], loading: true }));

  useEffect(() => {
    let alive = true;
    if (!ctx || !personSA) { setState({ orgs: [], loading: false }); return; }
    // Instant: show the cached set while the vault read is in flight.
    setState({ orgs: toLive(cachedMyOrgs(personSA)), loading: true });
    listMyOrgs(ctx)
      .then((all) => { if (alive) setState({ orgs: toLive(all), loading: false }); })
      .catch(() => { if (alive) setState((s) => ({ orgs: s.orgs, loading: false })); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, personSA, refreshKey]);

  return state;
}
