"use client";

// Live on-chain reads for the connected agent, through the same /a2a proxy the rest of
// the app uses. No vault/delegation infra needed — just real balances from Base Sepolia.
import { useEffect, useState } from "react";
import { erc20BalanceOf, getEthBalance, formatUnits } from "./backend";
import { CONTRACTS } from "./chain";
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
