"use client";

// Live on-chain reads for the connected agent, through the same /a2a proxy the rest of
// the app uses. No vault/delegation infra needed — just real balances from Base Sepolia.
import { useEffect, useState } from "react";
import { erc20BalanceOf, getEthBalance, formatUnits } from "./backend";
import { CONTRACTS } from "./chain";
import { listMyOrgs } from "./related";
import type { Address } from "./types";

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
export function usePersonTreasury(token?: string | null, refreshKey = 0): TreasuryInfo {
  const [state, setState] = useState<TreasuryInfo>({ exists: false, name: null, address: null, usdc: null, loading: true });

  useEffect(() => {
    let alive = true;
    if (!token) { setState({ exists: false, name: null, address: null, usdc: null, loading: false }); return; }
    setState((s) => ({ ...s, loading: true }));
    (async () => {
      try {
        const orgs = await listMyOrgs(token);
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
  }, [token, refreshKey]);

  return state;
}
