"use client";

import { useSession } from "@/context/session";
import { orgById } from "@/lib/seed";
import { SectionHead, Pill } from "@/components/ui";
import { IconKey, IconShield, IconCheck } from "@/components/Icons";

export default function SecurityPage() {
  const { person, active, via } = useSession();
  if (!person) return null;
  const isOrg = active.mode === "org";
  const subject = isOrg ? orgById(active.orgId)?.name : person.name;

  const devices = [
    { name: "Grace's MacBook", method: "passkey", last: "today", current: via === "passkey" },
    { name: "iPhone 16", method: "passkey", last: "2 days ago", current: false },
    { name: "Google identity", method: "google", last: "1 week ago", current: via === "google" },
  ];

  return (
    <>
      <SectionHead
        eyebrow={isOrg ? "Organization security" : "Your security"}
        title="Security"
        sub={`How ${subject} is secured. No private key is ever held by a service — every action is authorized by your credential.`}
      />

      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", marginBottom: "1.4rem" }}>
        <div className="card card-pad">
          <div className="row" style={{ gap: ".6rem" }}>
            <div className="glyph glyph-sm glyph-person"><IconShield width={16} height={16} /></div>
            <strong>Custody model</strong>
          </div>
          <ul style={{ margin: ".8rem 0 0", paddingLeft: "1.1rem", fontSize: ".86rem", lineHeight: 1.7 }}>
            <li>Root credential signs every delegation leaf</li>
            <li>No held keys — KMS custody for social sign-in</li>
            <li>Vault key wrapped by KMS, bound to demo-mcp</li>
          </ul>
        </div>
        <div className="card card-pad">
          <div className="row" style={{ gap: ".6rem" }}>
            <div className="glyph glyph-sm" style={{ background: "var(--surface-sunken)", color: "var(--amber-700)" }}><IconKey width={16} height={16} /></div>
            <strong>Vault key authorization</strong>
          </div>
          <div className="row wrap" style={{ gap: ".4rem", marginTop: ".8rem" }}>
            <Pill tone="emerald"><IconCheck width={13} height={13} /> bound</Pill>
            <Pill>KMS-wrapped DEK</Pill>
            <Pill>non-subdelegable</Pill>
          </div>
          <div className="faint" style={{ fontSize: ".76rem", marginTop: ".6rem" }}>
            VAULT_KEY_USE caveat · person SA → demo-mcp
          </div>
        </div>
      </div>

      <SectionHead title="Devices & credentials" sub="Where you can open this home." />
      <div className="card" style={{ overflow: "hidden" }}>
        {devices.map((d, i) => (
          <div key={d.name} className="row-between" style={{ padding: "0.9rem 1.2rem", borderTop: i ? "1px solid var(--border)" : undefined }}>
            <div className="row" style={{ gap: ".7rem" }}>
              <div className="glyph glyph-sm" style={{ background: "var(--surface-sunken)", color: "var(--text-muted)" }}><IconKey width={15} height={15} /></div>
              <div>
                <div style={{ fontWeight: 600 }}>{d.name}</div>
                <div className="faint" style={{ fontSize: ".74rem" }}>{d.method} · last used {d.last}</div>
              </div>
            </div>
            <div className="row" style={{ gap: ".4rem" }}>
              {d.current && <Pill tone="emerald">this session</Pill>}
              <button className="btn btn-quiet btn-sm">Remove</button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
