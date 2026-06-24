"use client";

import "@xyflow/react/dist/style.css";
import { useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import {
  buildOrgGraph,
  buildPersonGraph,
  CUSTODIAN_ID,
  EDGE_KIND_STYLE,
  nodeMeta,
  type GNodeKind,
} from "@/lib/graph";
import { PERSON, orgById, serviceById, servicesForOrg, PEERS } from "@/lib/seed";
import { Glyph, Pill, TrustMeter, DimensionBadges } from "@/components/ui";

type NodeData = { refId: string; kind: GNodeKind; name: string; sub: string; trust?: number; focus?: boolean };

function TrustNode({ data, selected }: NodeProps<Node<NodeData>>) {
  return (
    <div className={`tg-node kind-${data.kind} ${selected || data.focus ? "sel" : ""}`}>
      <Handle type="target" position={Position.Left} />
      <Handle type="target" position={Position.Top} />
      <div className="row" style={{ gap: ".55rem" }}>
        <Glyph kind={data.kind} name={data.name} size="sm" />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: ".82rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {data.name}
          </div>
          <div className="faint" style={{ fontSize: ".68rem" }}>{data.sub}</div>
        </div>
      </div>
      {data.trust !== undefined && (
        <div style={{ marginTop: ".5rem" }}>
          <TrustMeter value={data.trust} />
        </div>
      )}
      <Handle type="source" position={Position.Right} />
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

const nodeTypes = { trust: TrustNode };

export default function TrustGraph({ view, orgId }: { view: "person" | "org"; orgId?: string }) {
  const [selected, setSelected] = useState<string | null>(null);

  const g = useMemo(
    () => (view === "org" && orgId ? buildOrgGraph(orgId) : buildPersonGraph()),
    [view, orgId],
  );

  const nodes: Node<NodeData>[] = g.nodes.map((n) => ({
    id: n.id,
    type: "trust",
    position: n.position,
    data: n.data,
    selected: n.id === selected,
  }));

  const edges: Edge[] = g.edges.map((e) => {
    const st = EDGE_KIND_STYLE[e.kind];
    const isControl = st.cls === "control";
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label,
      // only AUTHORITY edges animate + carry weight; control stays quiet.
      animated: !isControl && (e.kind === "payment" || e.kind === "delegation"),
      style: {
        stroke: st.color,
        strokeWidth: isControl ? 1.4 : 1.6 + e.weight,
        strokeDasharray: st.dotted ? "1 6" : st.dashed ? "6 4" : undefined,
        opacity: isControl ? 0.75 : 1,
      },
      labelStyle: { fontSize: 10, fill: isControl ? "var(--text-faint)" : "var(--text-muted)", fontWeight: 600 },
      labelBgStyle: { fill: "var(--surface)", fillOpacity: 0.9 },
      labelBgPadding: [4, 2] as [number, number],
      labelBgBorderRadius: 4,
      markerEnd: { type: MarkerType.ArrowClosed, color: st.color, width: 15, height: 15 },
    };
  });

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.4}
        maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, n) => setSelected(n.id)}
        onPaneClick={() => setSelected(null)}
        nodesDraggable
        className="trustgraph"
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="#e0d9ca" />
        <Controls showInteractive={false} />
      </ReactFlow>

      <Legend />
      {selected && <Inspector refId={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function LegendRow({ color, dashed, dotted, label, faint }: { color: string; dashed?: boolean; dotted?: boolean; label: string; faint?: boolean }) {
  return (
    <div className="row" style={{ gap: ".5rem", fontSize: ".74rem" }}>
      <span style={{ width: 22, height: 0, borderTop: `2px ${dotted ? "dotted" : dashed ? "dashed" : "solid"} ${color}` }} />
      <span className={faint ? "faint" : "muted"}>{label}</span>
    </div>
  );
}

function Legend() {
  const entries = Object.values(EDGE_KIND_STYLE);
  const control = entries.filter((s) => s.cls === "control");
  const authority = entries.filter((s) => s.cls === "authority");
  return (
    <div className="tg-legend">
      <div className="eyebrow" style={{ marginBottom: ".4rem", color: "var(--text-faint)" }}>Control · custody</div>
      <div className="col" style={{ gap: ".3rem", marginBottom: ".6rem" }}>
        {control.map((st) => (
          <LegendRow key={st.label} color={st.color} dashed={st.dashed} dotted={st.dotted} label={st.label} faint />
        ))}
      </div>
      <div className="eyebrow" style={{ marginBottom: ".4rem" }}>Authority &amp; trust · agent → agent</div>
      <div className="col" style={{ gap: ".3rem" }}>
        {authority.map((st) => (
          <LegendRow key={st.label} color={st.color} dashed={st.dashed} label={st.label} />
        ))}
      </div>
    </div>
  );
}

function Inspector({ refId, onClose }: { refId: string; onClose: () => void }) {
  const meta = nodeMeta(refId);
  return (
    <div className="inspector anim-in">
      <div className="card-pad" style={{ borderBottom: "1px solid var(--border)" }}>
        <div className="row-between">
          <div className="row" style={{ gap: ".6rem" }}>
            <Glyph kind={meta.kind} name={meta.name} size="md" />
            <div>
              <strong>{meta.name}</strong>
              <div className="faint" style={{ fontSize: ".74rem" }}>{meta.sub}</div>
            </div>
          </div>
          <button className="btn btn-quiet btn-sm" onClick={onClose}>✕</button>
        </div>
      </div>
      <div className="card-pad col" style={{ gap: ".8rem" }}>
        <InspectorBody refId={refId} />
      </div>
    </div>
  );
}

function InspectorBody({ refId }: { refId: string }) {
  // The connected human custodian
  if (refId === CUSTODIAN_ID) {
    return (
      <>
        <Pill>control · custody</Pill>
        <p className="muted" style={{ fontSize: ".84rem" }}>
          This is <strong>you</strong> — the human who holds the keys to your person agent
          (<code className="mono">{PERSON.agentName}</code>) via your passkey.
        </p>
        <p className="faint" style={{ fontSize: ".8rem" }}>
          Custody is a <strong>control</strong> relationship, not authority. It is the only link
          that crosses from a person to an agent. Everything else in this graph is
          <strong> authority between smart agents</strong> — delegations, entitlements, stewardship —
          which is where trust is actually built.
        </p>
      </>
    );
  }
  // Service agent
  const svc = serviceById(refId);
  if (svc) {
    return (
      <>
        <Pill tone="plum">{svc.role === "trust" ? "★ trust agent" : `${svc.role} service`}</Pill>
        {svc.trust && (
          <div>
            <div className="row-between"><span className="faint" style={{ fontSize: ".74rem" }}>trust</span><strong>{Math.round(svc.trust.overall * 100)}%</strong></div>
            <TrustMeter value={svc.trust.overall} />
            <div style={{ marginTop: ".6rem" }}><DimensionBadges trust={svc.trust} /></div>
          </div>
        )}
        <div className="eyebrow">Exposed skills</div>
        {svc.skills.map((k) => (
          <div key={k.id} className="row-between" style={{ fontSize: ".82rem" }}>
            <span>{k.name}</span>
            <Pill tone={k.enabled ? "emerald" : "default"}>{k.enabled ? "live" : "off"}</Pill>
          </div>
        ))}
        <code className="mono faint" style={{ fontSize: ".7rem" }}>{svc.agentName}</code>
      </>
    );
  }
  // Org
  const org = orgById(refId);
  if (org) {
    return (
      <>
        <p className="muted" style={{ fontSize: ".84rem" }}>{org.profile.mission}</p>
        {org.trust && (
          <div>
            <div className="row-between"><span className="faint" style={{ fontSize: ".74rem" }}>org trust · {org.trust.corroborations} sources</span><strong>{Math.round(org.trust.overall * 100)}%</strong></div>
            <TrustMeter value={org.trust.overall} />
            <div style={{ marginTop: ".6rem" }}><DimensionBadges trust={org.trust} /></div>
          </div>
        )}
        <div className="row wrap" style={{ gap: ".4rem" }}>
          <Pill tone="plum">{servicesForOrg(org.id).length} service agents</Pill>
          <Pill>{org.memberIds.length} members</Pill>
          <Pill tone="emerald">${org.treasury.balanceUsdc.toLocaleString()}</Pill>
        </div>
        {org.attestations.length > 0 && (
          <>
            <div className="eyebrow">Partner attestations</div>
            {org.attestations.map((a) => (
              <div key={a.id} style={{ fontSize: ".8rem" }}>
                <strong>{a.by}</strong> — {a.statement}
                <span className="faint"> · conf {a.confidence.toFixed(2)}</span>
              </div>
            ))}
          </>
        )}
      </>
    );
  }
  // Person (focus or peer)
  const p = refId === PERSON.id ? PERSON : PEERS.find((x) => x.id === refId);
  return (
    <>
      {refId === PERSON.id ? (
        <>
          <p className="muted" style={{ fontSize: ".84rem" }}>{PERSON.blurb}</p>
          {PERSON.trust && (
            <div>
              <div className="row-between"><span className="faint" style={{ fontSize: ".74rem" }}>agentic trust</span><strong>{Math.round(PERSON.trust.overall * 100)}%</strong></div>
              <TrustMeter value={PERSON.trust.overall} />
              <div style={{ marginTop: ".6rem" }}><DimensionBadges trust={PERSON.trust} /></div>
            </div>
          )}
          <div className="row wrap" style={{ gap: ".4rem" }}>
            <Pill tone="amber">custodian of {PERSON.custodyOf.length}</Pill>
            <Pill>member of {PERSON.membershipIds.length}</Pill>
          </div>
        </>
      ) : (
        <p className="muted" style={{ fontSize: ".84rem" }}>{p?.blurb}</p>
      )}
      <code className="mono faint" style={{ fontSize: ".7rem" }}>{p?.agentName}</code>
    </>
  );
}
