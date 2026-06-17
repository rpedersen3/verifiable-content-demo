// spec 277 — D1-backed implementation of the @agenticprimitives/vault `Vault` seam (Phase 1: plaintext).
// One VaultObjectEnvelopeV1 per (owner, resource); soft-delete via deletedAt; field projection on read.
// Phase 2 (backlog B7) swaps `plaintext` for `crypto` refs (sealEnvelope/openEnvelope + a key-custody
// DekWrapper) — the on-disk envelope shape is unchanged, so only this adapter changes.
import { projectFields, type Vault, type VaultObject, type VaultReadRequest, type VaultWriteRequest, type VaultRef, type VaultObjectEnvelopeV1, type VaultClassification } from '@agenticprimitives/vault';
import type { D1Like } from '../editions/d1.js';

const nowIso = () => new Date().toISOString();
const parse = <T = unknown>(s: string) => JSON.parse(s) as VaultObjectEnvelopeV1<T>;

export function createD1Vault(db: D1Like): Vault {
  return {
    async read<T = unknown>(req: VaultReadRequest): Promise<VaultObject<T> | null> {
      const row = await db.prepare('SELECT envelope FROM vault_objects WHERE owner=? AND resource=? AND deleted_at IS NULL').bind(req.owner, req.resource).first<{ envelope: string }>();
      if (!row) return null;
      const env = parse<T>(row.envelope);
      if (env.deletedAt) return null;
      return { owner: env.owner, resource: env.resource, classification: env.classification, data: projectFields(env.plaintext, req.fields) as T, updatedAt: env.updatedAt };
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
      const envelope: VaultObjectEnvelopeV1<T> = {
        type: 'VaultObjectEnvelopeV1',
        owner: req.owner,
        resource: req.resource,
        classification,
        plaintext: req.data,
        createdAt: prior?.createdAt ?? now,
        updatedAt: now,
        deletedAt: null,
      };
      await db.prepare('INSERT INTO vault_objects(owner,resource,classification,envelope,updated_at,deleted_at) VALUES(?,?,?,?,?,NULL) ON CONFLICT(owner,resource) DO UPDATE SET classification=excluded.classification, envelope=excluded.envelope, updated_at=excluded.updated_at, deleted_at=NULL')
        .bind(req.owner, req.resource, classification, JSON.stringify(envelope), now).run();
    },

    async list(owner: string): Promise<VaultRef[]> {
      const rows = (await db.prepare('SELECT resource, classification, updated_at FROM vault_objects WHERE owner=? AND deleted_at IS NULL ORDER BY resource').bind(owner).all<{ resource: string; classification: VaultClassification; updated_at: string }>()).results;
      return rows.map((r) => ({ resource: r.resource, classification: r.classification, updatedAt: r.updated_at }));
    },
  };
}
