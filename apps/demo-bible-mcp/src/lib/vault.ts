// spec 277 — D1-backed implementation of the @agenticprimitives/vault `Vault` seam.
// Non-sensitive objects are stored plaintext; sensitive classes (P5) are AES-256-GCM sealed under a
// KMS-wrapped DEK via the injected DekWrapper (key-custody GcpKmsProvider) — sealEnvelope/openEnvelope.
// The plaintext-free envelope (with crypto refs) goes in `envelope`; the ciphertext + wrapped DEK go in
// the ciphertext/wrapped_dek columns. Field projection happens after decrypt. Soft-delete via deletedAt.
import { projectFields, sealEnvelope, openEnvelope, isSensitiveClassification, type Vault, type VaultObject, type VaultReadRequest, type VaultWriteRequest, type VaultRef, type VaultObjectEnvelopeV1, type VaultClassification, type DekWrapper } from '@agenticprimitives/vault';
import type { D1Like } from '../editions/d1.js';

const nowIso = () => new Date().toISOString();
const parse = <T = unknown>(s: string) => JSON.parse(s) as VaultObjectEnvelopeV1<T>;
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** `wrapper` (key-custody GcpKmsProvider) enables envelope encryption for sensitive classes; omit for plaintext. */
export function createD1Vault(db: D1Like, wrapper?: DekWrapper): Vault {
  return {
    async read<T = unknown>(req: VaultReadRequest): Promise<VaultObject<T> | null> {
      const row = await db.prepare('SELECT envelope, ciphertext, wrapped_dek FROM vault_objects WHERE owner=? AND resource=? AND deleted_at IS NULL').bind(req.owner, req.resource).first<{ envelope: string; ciphertext: string | null; wrapped_dek: string | null }>();
      if (!row) return null;
      const env = parse<T>(row.envelope);
      if (env.deletedAt) return null;
      let data: T;
      if (env.crypto) {
        if (!wrapper) throw new Error(`vault object ${req.owner}/${req.resource} is encrypted but no key provider is configured`);
        data = await openEnvelope<T>({ envelope: env, ciphertext: unb64(row.ciphertext!), wrappedDek: unb64(row.wrapped_dek!), wrapper });
      } else {
        data = env.plaintext as T;
      }
      return { owner: env.owner, resource: env.resource, classification: env.classification, data: projectFields(data, req.fields) as T, updatedAt: env.updatedAt };
    },

    async write<T = unknown>(req: VaultWriteRequest<T>): Promise<void> {
      const now = nowIso();
      if (req.data === null) {
        await db.prepare('UPDATE vault_objects SET deleted_at=?, updated_at=? WHERE owner=? AND resource=?').bind(now, now, req.owner, req.resource).run();
        return;
      }
      const existing = await db.prepare('SELECT envelope FROM vault_objects WHERE owner=? AND resource=?').bind(req.owner, req.resource).first<{ envelope: string }>();
      const prior = existing ? parse(existing.envelope) : null;
      const classification: VaultClassification = req.classification ?? prior?.classification ?? 'internal';
      let envelopeJson: string;
      let ciphertext: string | null = null;
      let wrappedDek: string | null = null;
      if (wrapper && isSensitiveClassification(classification)) {
        const sealed = await sealEnvelope({ owner: req.owner, resource: req.resource, classification, data: req.data, wrapper });
        envelopeJson = JSON.stringify(sealed.envelope);
        ciphertext = b64(sealed.ciphertext);
        wrappedDek = b64(sealed.wrappedDek);
      } else {
        const envelope: VaultObjectEnvelopeV1<T> = { type: 'VaultObjectEnvelopeV1', owner: req.owner, resource: req.resource, classification, plaintext: req.data, createdAt: prior?.createdAt ?? now, updatedAt: now, deletedAt: null };
        envelopeJson = JSON.stringify(envelope);
      }
      await db.prepare('INSERT INTO vault_objects(owner,resource,classification,envelope,ciphertext,wrapped_dek,updated_at,deleted_at) VALUES(?,?,?,?,?,?,?,NULL) ON CONFLICT(owner,resource) DO UPDATE SET classification=excluded.classification, envelope=excluded.envelope, ciphertext=excluded.ciphertext, wrapped_dek=excluded.wrapped_dek, updated_at=excluded.updated_at, deleted_at=NULL')
        .bind(req.owner, req.resource, classification, envelopeJson, ciphertext, wrappedDek, now).run();
    },

    async list(owner: string): Promise<VaultRef[]> {
      const rows = (await db.prepare('SELECT resource, classification, updated_at FROM vault_objects WHERE owner=? AND deleted_at IS NULL ORDER BY resource').bind(owner).all<{ resource: string; classification: VaultClassification; updated_at: string }>()).results;
      return rows.map((r) => ({ resource: r.resource, classification: r.classification, updatedAt: r.updated_at }));
    },
  };
}
