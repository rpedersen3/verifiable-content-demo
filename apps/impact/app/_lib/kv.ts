// Vercel KV (Upstash Redis) adapter implementing the broker's `KVNamespace`
// surface (spec 232 §4). The Cloudflare KV the broker was written against stores
// + returns RAW STRINGS (the broker does its own JSON.stringify/parse). Upstash's
// default auto-(de)serialization would corrupt that, so we construct the client
// with `automaticDeserialization: false` to match Cloudflare KV byte-for-byte.
//
// Vercel KV provisions `KV_REST_API_URL` + `KV_REST_API_TOKEN`.
import { Redis } from '@upstash/redis';
import type { KVNamespace } from '../../server/_lib/server-broker';

// Resolve the Upstash/Vercel-KV REST credentials. Accepts, in order:
//   1. the legacy "Vercel KV" names (KV_REST_API_*) + the Upstash Marketplace names (UPSTASH_REDIS_REST_*);
//   2. a PREFIXED pair — Vercel's "Connect Store" injects vars under an integration prefix
//      (e.g. `democorpus_KV_REST_API_URL` / `..._TOKEN`), which the unprefixed lookup above misses.
// The prefixed fallback pairs a non-empty `<prefix>KV_REST_API_URL` with its matching `<prefix>KV_REST_API_TOKEN`
// (never the READ_ONLY token), so a store connected under any prefix Just Works.
function resolveKvCreds(): { url: string; token: string } {
  const env = process.env;
  const url0 = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL || '';
  const token0 = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN || '';
  if (url0 && token0) return { url: url0, token: token0 };
  for (const key of Object.keys(env)) {
    const m = /^(.*)(?:KV_REST_API_URL|UPSTASH_REDIS_REST_URL)$/.exec(key);
    if (!m || !env[key]) continue;
    const prefix = m[1];
    const tKey = env[`${prefix}KV_REST_API_TOKEN`] ? `${prefix}KV_REST_API_TOKEN`
      : env[`${prefix}UPSTASH_REDIS_REST_TOKEN`] ? `${prefix}UPSTASH_REDIS_REST_TOKEN` : '';
    if (tKey && env[tKey]) return { url: env[key] as string, token: env[tKey] as string };
  }
  return { url: '', token: '' };
}
const { url, token } = resolveKvCreds();

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
