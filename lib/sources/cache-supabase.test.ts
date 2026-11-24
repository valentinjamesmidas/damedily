import { describe, expect, it } from "vitest";
import { createSupabaseOemCache, readOemCacheTtlMs } from "./cache-supabase";
import type { SourceOffer } from "./types";

const offer: SourceOffer = {
  source: "allegro",
  oem: "1K0615301",
  name: "Wahacz",
  condition: "used",
  price: { amount: 123.45, currency: "PLN" },
  availability: "3",
  url: "https://allegro.pl/oferta/10000000001",
  fetchedAt: "2026-11-24T11:30:00.000Z",
};

const env = {
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SERVICE_ROLE_KEY: "service-secret",
};

describe("readOemCacheTtlMs", () => {
  it("bez proměnné drží 6 hodin a rozbitou hodnotu odmítne", () => {
    expect(readOemCacheTtlMs({})).toBe(21_600_000);
    expect(readOemCacheTtlMs({ OEM_CACHE_TTL_MS: "1000" })).toBe(1000);
    expect(() => readOemCacheTtlMs({ OEM_CACHE_TTL_MS: "0" })).toThrow(/OEM_CACHE_TTL_MS/);
    expect(() => readOemCacheTtlMs({ OEM_CACHE_TTL_MS: "abc" })).toThrow(/OEM_CACHE_TTL_MS/);
  });
});

describe("createSupabaseOemCache", () => {
  it("bez URL a klíče síť nevolá", async () => {
    let called = false;
    const cache = createSupabaseOemCache({}, async () => {
      called = true;
      return new Response("nemělo se volat", { status: 500 });
    });
    expect(await cache.read("1K0615301", "allegro", new Date())).toBeNull();
    await cache.write({
      oem: "1K0615301",
      source: "allegro",
      payload: [offer],
      fetchedAt: offer.fetchedAt,
      ttlMs: 3_600_000,
    });
    expect(called).toBe(false);
  });

  it("přečte čerstvý řádek a vypršený zahodí", async () => {
    const cache = createSupabaseOemCache(env, async () =>
      Response.json([
        {
          oem: "1K0615301",
          source: "allegro",
          payload: [offer],
          fetched_at: "2026-11-24T11:30:00+00:00",
          ttl: "01:00:00",
        },
      ]),
    );
    const now = new Date("2026-11-24T12:00:00.000Z");
    expect((await cache.read("1K0615301", "allegro", now))?.payload).toEqual([offer]);

    const stale = createSupabaseOemCache(env, async () =>
      Response.json([
        {
          oem: "1K0615301",
          source: "allegro",
          payload: [offer],
          fetched_at: "2026-11-24T10:00:00+00:00",
          ttl: "01:00:00",
        },
      ]),
    );
    expect(await stale.read("1K0615301", "allegro", now)).toBeNull();
  });

  it("rozbitý payload nevrátí jako nabídky", async () => {
    const cache = createSupabaseOemCache(env, async () =>
      Response.json([
        {
          oem: "1K0615301",
          source: "allegro",
          payload: [{ price: 123.45 }],
          fetched_at: "2026-11-24T11:30:00+00:00",
          ttl: "01:00:00",
        },
      ]),
    );
    expect(await cache.read("1K0615301", "allegro", new Date("2026-11-24T12:00:00.000Z"))).toBeNull();
  });

  it("zapíše upsert service role a při chybě hodí stav bez těla", async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const cache = createSupabaseOemCache(env, async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(null, { status: 201 });
    });
    await cache.write({
      oem: "1K0615301",
      source: "allegro",
      payload: [offer],
      fetchedAt: "2026-11-24T12:00:00.000Z",
      ttlMs: 3_600_000,
    });
    expect(calls).toHaveLength(1);
    const call = calls[0];
    if (!call) throw new Error("chybí požadavek");
    expect(call.url).toBe("http://127.0.0.1:54321/rest/v1/oem_cache?on_conflict=oem,source");
    expect(call.url).not.toContain("service-secret");
    const headers = new Headers(call.init?.headers);
    expect(headers.get("authorization")).toBe("Bearer service-secret");
    expect(headers.get("prefer")).toContain("resolution=merge-duplicates");
    expect(JSON.parse(String(call.init?.body))).toEqual({
      oem: "1K0615301",
      source: "allegro",
      payload: [offer],
      fetched_at: "2026-11-24T12:00:00.000Z",
      ttl: "3600 seconds",
    });

    const failing = createSupabaseOemCache(env, async () => new Response("tajné tělo", { status: 500 }));
    await expect(
      failing.write({
        oem: "1K0615301",
        source: "allegro",
        payload: [offer],
        fetchedAt: "2026-11-24T12:00:00.000Z",
        ttlMs: 3_600_000,
      }),
    ).rejects.toThrow("oem_cache se nepodařilo zapsat (500).");
  });
});
