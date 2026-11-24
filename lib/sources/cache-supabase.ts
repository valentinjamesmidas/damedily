import "server-only";

import { isCacheableOem } from "@/lib/sources/oem";
import {
  cacheRowFresh,
  intervalToMs,
  isCacheableSource,
  parseCachedOffers,
  type OemCache,
  type OemCacheRow,
} from "@/lib/sources/cache";

export const DEFAULT_OEM_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export function readOemCacheTtlMs(env: Record<string, string | undefined>): number {
  const raw = env.OEM_CACHE_TTL_MS;
  if (raw === undefined || raw.trim() === "") return DEFAULT_OEM_CACHE_TTL_MS;
  if (!/^\d+$/.test(raw.trim()) || Number(raw.trim()) <= 0) {
    throw new TypeError("OEM_CACHE_TTL_MS musí být kladné celé číslo.");
  }
  return Number(raw.trim());
}

function endpoint(env: Record<string, string | undefined>): { url: string; key: string } | null {
  const url = (env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (!url || !key) return null;
  return { url, key };
}

function headers(key: string, json: boolean): Record<string, string> {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Accept: "application/json",
    ...(json ? { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" } : {}),
  };
}

function rowFromApi(value: unknown, now: Date): OemCacheRow | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.oem !== "string" || typeof record.source !== "string") return null;
  if (typeof record.fetched_at !== "string" || typeof record.ttl !== "string") return null;
  const ttlMs = intervalToMs(record.ttl);
  const payload = parseCachedOffers(record.payload);
  if (ttlMs === null || !payload) return null;
  const row: OemCacheRow = {
    oem: record.oem,
    source: record.source,
    payload,
    fetchedAt: record.fetched_at,
    ttlMs,
  };
  return cacheRowFresh(row, now) ? row : null;
}

/**
 * Čtení a zápis `oem_cache` přes PostgREST service role.
 * Bez URL nebo klíče nic nevolá: čtení vrátí null, zápis se přeskočí.
 */
export function createSupabaseOemCache(
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch = fetch,
): OemCache {
  return {
    async read(oem, source, now) {
      const target = endpoint(env);
      if (!target || !isCacheableOem(oem) || !isCacheableSource(source)) return null;
      const params = new URLSearchParams();
      params.set("select", "oem,source,payload,fetched_at,ttl");
      params.set("oem", `eq.${oem}`);
      params.set("source", `eq.${source}`);
      const response = await fetchImpl(`${target.url}/rest/v1/oem_cache?${params}`, {
        headers: headers(target.key, false),
        signal: AbortSignal.timeout(4_000),
      });
      if (!response.ok) return null;
      const body: unknown = await response.json();
      const first = Array.isArray(body) ? body[0] : null;
      return rowFromApi(first, now);
    },

    async write(row) {
      const target = endpoint(env);
      if (!target) return;
      if (!isCacheableOem(row.oem) || !isCacheableSource(row.source)) {
        throw new TypeError("Do cache patří jen cacheovatelné OEM a id zdroje.");
      }
      const response = await fetchImpl(`${target.url}/rest/v1/oem_cache?on_conflict=oem,source`, {
        method: "POST",
        headers: headers(target.key, true),
        body: JSON.stringify({
          oem: row.oem,
          source: row.source,
          payload: row.payload,
          fetched_at: row.fetchedAt,
          ttl: `${Math.round(row.ttlMs / 1000)} seconds`,
          in_flight_until: null,
        }),
        signal: AbortSignal.timeout(4_000),
      });
      if (!response.ok) {
        throw new Error(`oem_cache se nepodařilo zapsat (${response.status}).`);
      }
    },

    async tryLease(oem, source, until) {
      const target = endpoint(env);
      if (!target || !isCacheableOem(oem) || !isCacheableSource(source)) return false;
      const response = await fetchImpl(`${target.url}/rest/v1/rpc/try_lease_oem_cache`, {
        method: "POST",
        headers: headers(target.key, true),
        body: JSON.stringify({ p_oem: oem, p_source: source, p_until: until.toISOString() }),
        signal: AbortSignal.timeout(4_000),
      });
      if (!response.ok) throw new Error(`try_lease_oem_cache selhal (${response.status}).`);
      const body: unknown = await response.json();
      return body === true || body === "true";
    },

    async releaseLease(oem, source) {
      const target = endpoint(env);
      if (!target || !isCacheableOem(oem) || !isCacheableSource(source)) return;
      const response = await fetchImpl(`${target.url}/rest/v1/rpc/release_lease_oem_cache`, {
        method: "POST",
        headers: headers(target.key, true),
        body: JSON.stringify({ p_oem: oem, p_source: source }),
        signal: AbortSignal.timeout(4_000),
      });
      if (!response.ok) throw new Error(`release_lease_oem_cache selhal (${response.status}).`);
    },
  };
}
