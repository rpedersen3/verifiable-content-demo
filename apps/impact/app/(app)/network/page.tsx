"use client";

import { useEffect, useState } from "react";
import { SectionHead, Pill, StatTile } from "@/components/ui";
import { getBlockNumber, getDeployments, getHealth, type Deployments, type Health } from "@/lib/backend";
import { BACKEND } from "@/lib/domain";

interface McpHealth { ok: boolean; service: string }

const CHAIN_NAME: Record<number, string> = { 84532: "Base Sepolia", 8453: "Base" };
const explorer = (chainId: number) => (chainId === 84532 ? "https://sepolia.basescan.org" : "https://basescan.org");

const REGISTRY_LABELS: Record<string, string> = {
  delegationManager: "Delegation Manager",
  agentAccountFactory: "Agent Account Factory",
  timestampEnforcer: "Timestamp Enforcer",
  allowedTargetsEnforcer: "Allowed-Targets Enforcer",
  allowedMethodsEnforcer: "Allowed-Methods Enforcer",
  valueEnforcer: "Value Enforcer",
  universalSignatureValidator: "Universal Signature Validator",
  agentNameRegistry: "Agent Name Registry",
  agentNameUniversalResolver: "Agent Name Resolver",
};

export default function NetworkPage() {
  const [a2a, setA2a] = useState<Health | null>(null);
  const [mcp, setMcp] = useState<McpHealth | null>(null);
  const [deploy, setDeploy] = useState<Deployments | null>(null);
  const [block, setBlock] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [h, d] = await Promise.all([getHealth(), getDeployments()]);
        if (!alive) return;
        setA2a(h);
        setDeploy(d);
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : "backend unreachable");
      }
      try {
        const m = await fetch(`${BACKEND.mcpBind}/health`).then((r) => r.json());
        if (alive) setMcp(m as McpHealth);
      } catch { /* mcp optional */ }
    })();

    async function tickBlock() {
      try { const bn = await getBlockNumber(); if (alive) setBlock(bn); } catch { /* ignore */ }
    }
    tickBlock();
    const t = setInterval(tickBlock, 12000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const chainId = a2a?.chainId ?? deploy?.chainId ?? 84532;
  const base = explorer(chainId);
  const registryRows = deploy
    ? Object.entries(deploy).filter(([, v]) => typeof v === "string" && String(v).startsWith("0x"))
    : [];

  return (
    <>
      <SectionHead
        eyebrow="Live backend"
        title="Network"
        sub="Impact reads live from the deployed impact-a2a / impact-mcp backend through a same-origin proxy. Everything below is fetched on-chain in real time."
      />

      {err && <div className="card card-pad chip-danger" style={{ marginBottom: "1.2rem" }}>Backend unreachable: {err}</div>}

      <div className="grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: "1.4rem" }}>
        <StatTile num={CHAIN_NAME[chainId] ?? `Chain ${chainId}`} label={`chainId ${chainId}`} accent="var(--emerald-700)" />
        <StatTile num={block !== null ? `#${block.toLocaleString()}` : "…"} label="Current block (live, 12s)" />
        <StatTile num={`${[a2a?.ok, mcp?.ok].filter(Boolean).length}/2`} label="Backends healthy" />
      </div>

      <SectionHead title="Services" />
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", marginBottom: "1.6rem" }}>
        <ServiceCard label="impact-a2a" sub="relayer · custody bridge · vault proxy" ok={!!a2a?.ok} detail={a2a?.runtime} />
        <ServiceCard label="impact-mcp" sub="vault · vault-key bind ceremony" ok={!!mcp?.ok} detail={mcp?.service} />
      </div>

      <SectionHead title="On-chain contract registry" sub="Pulled live from impact-a2a /deployments. Click to open the block explorer." />
      <div className="card" style={{ overflow: "hidden" }}>
        {registryRows.length === 0 && <div className="card-pad muted">Loading registry…</div>}
        {registryRows.map(([k, v], i) => (
          <a
            key={k}
            href={`${base}/address/${v}`}
            target="_blank"
            rel="noreferrer"
            className="row-between"
            style={{ padding: ".8rem 1.2rem", borderTop: i ? "1px solid var(--border)" : undefined }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: ".9rem" }}>{REGISTRY_LABELS[k] ?? k}</div>
              <code className="mono faint" style={{ fontSize: ".72rem" }}>{k}</code>
            </div>
            <code className="addr">{String(v).slice(0, 10)}…{String(v).slice(-8)}</code>
          </a>
        ))}
      </div>

      <p className="faint" style={{ fontSize: ".78rem", marginTop: "1rem" }}>
        Live now: health, chain, block, contract registry, JSON-RPC reads (balances, code, reverse-name).
        Next: authenticated ceremonies — vault read/write, custody bootstrap, delegation signing — bind through
        this same layer once the custody-bridge secret + a session are provisioned.
      </p>
    </>
  );
}

function ServiceCard({ label, sub, ok, detail }: { label: string; sub: string; ok: boolean; detail?: string }) {
  return (
    <div className="card card-pad row-between">
      <div>
        <div className="row" style={{ gap: ".5rem" }}>
          <strong className="mono">{label}</strong>
          {detail && <span className="faint" style={{ fontSize: ".72rem" }}>{detail}</span>}
        </div>
        <div className="muted" style={{ fontSize: ".8rem" }}>{sub}</div>
      </div>
      <Pill tone={ok ? "emerald" : "danger"}><span className="dot" /> {ok ? "healthy" : "down"}</Pill>
    </div>
  );
}
