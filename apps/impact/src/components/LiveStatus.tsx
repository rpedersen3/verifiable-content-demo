"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getBlockNumber, getChainId } from "@/lib/backend";

const CHAIN_NAME: Record<number, string> = { 84532: "Base Sepolia", 8453: "Base" };

// Real backend status: pings the LIVE impact-a2a Worker (through the /a2a proxy) for
// chain id + current block, refreshing every 15s. Honest signal — green only when
// the deployed backend actually answers.
export default function LiveStatus() {
  const [state, setState] = useState<"checking" | "online" | "offline">("checking");
  const [chainId, setChainId] = useState<number | null>(null);
  const [block, setBlock] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const [cid, bn] = await Promise.all([
          chainId ?? getChainId(),
          getBlockNumber(),
        ]);
        if (!alive) return;
        setChainId(cid);
        setBlock(bn);
        setState("online");
      } catch {
        if (alive) setState("offline");
      }
    }
    tick();
    timer.current = setInterval(tick, 15000);
    return () => {
      alive = false;
      if (timer.current) clearInterval(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state === "offline") {
    return <span className="chip chip-danger" title="The live backend did not respond"><span className="dot" /> backend offline</span>;
  }
  if (state === "checking" || block === null) {
    return <span className="chip" title="Contacting the live backend"><span className="dot" style={{ color: "var(--text-faint)" }} /> connecting…</span>;
  }
  return (
    <Link href="/network" className="chip chip-emerald" title="Live impact-a2a · click for network details">
      <span className="dot" /> {CHAIN_NAME[chainId ?? 0] ?? `chain ${chainId}`} · #{block.toLocaleString()}
    </Link>
  );
}
