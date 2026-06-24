// Vercel KV (Upstash Redis) adapter implementing the broker's `KVNamespace`
// surface (spec 232 §4). The Cloudflare KV the broker was written against stores
// + returns RAW STRINGS (the broker does its own JSON.stringify/parse). Upstash's
// default auto-(de)serialization would corrupt that, so we construct the client
// with `automaticDeserialization: false` to match Cloudflare KV byte-for-byte.
//
// Vercel KV provisions `KV_REST_API_URL` + `KV_REST_API_TOKEN`.
import { Redis } from '@upstash/redis';
import type { KVNamespace } from '../../server/_lib/server-broker';

// Accept both the legacy "Vercel KV" names (KV_REST_API_*) and the current
// Upstash Marketplace integration names (UPSTASH_REDIS_REST_*).
const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL ?? '';
const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? '';

// Dev fallback: when no Upstash/Vercel-KV store is configured, use a process-local
// in-memory store so the broker (single-use nonces/challenges) works for LOCAL dev.
// Non-persistent + not multi-instance — production MUST attach a real KV store.
function inMemoryKv(): KVNamespace {
  const store = new Map<string, { v: string; exp?: number }>();
  console.warn('[impact] No KV store configured (KV_REST_API_URL/TOKEN) — using in-memory dev KV. Attach a Vercel KV / Upstash store for production.');
  return {
    async get(key) {
      const e = store.get(key);
      if (!e) return null;
      if (e.exp && Date.now() > e.exp) { store.delete(key); return null; }
      return e.v;
    },
    async put(key, value, opts) {
      store.set(key, { v: value, exp: opts?.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : undefined });
    },
    async delete(key) { store.delete(key); },
  };
}

function upstashKv(): KVNamespace {
  const redis = new Redis({ url, token, automaticDeserialization: false });
  return {
    async get(key: string): Promise<string | null> {
      const v = await redis.get<string>(key);
      return v ?? null;
    },
    async put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void> {
      if (opts?.expirationTtl) await redis.set(key, value, { ex: opts.expirationTtl });
      else await redis.set(key, value);
    },
    async delete(key: string): Promise<void> {
      await redis.del(key);
    },
  };
}

export const kv: KVNamespace = url && token ? upstashKv() : inMemoryKv();
