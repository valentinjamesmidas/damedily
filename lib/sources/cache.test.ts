import { describe, expect, it } from "vitest";
import { cacheRowFresh, intervalToMs, MemoryOemCache, type OemCacheRow } from "./cache";
import type { SourceOffer } from "./types";

const now = new Date("2026-11-24T12:00:00.000Z");

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

function row(overrides: Partial<OemCacheRow> = {}): OemCacheRow {
  return {
    oem: "1K0615301",
    source: "allegro",
    payload: [offer],
    fetchedAt: "2026-11-24T11:30:00.000Z",
    ttlMs: 60 * 60 * 1000,
    ...overrides,
  };
}

describe("intervalToMs", () => {
  it("přečte hodiny, dny i sekundy", () => {
    expect(intervalToMs("01:00:00")).toBe(3_600_000);
    expect(intervalToMs("00:00:30")).toBe(30_000);
    expect(intervalToMs("1 day")).toBe(86_400_000);
    expect(intervalToMs("1 day 01:00:00")).toBe(90_000_000);
    expect(intervalToMs("21600 seconds")).toBe(21_600_000);
    expect(intervalToMs("1 second")).toBe(1_000);
  });

  it("neznámý nebo rozbitý zápis nevrátí číslo", () => {
    expect(intervalToMs("")).toBeNull();
    expect(intervalToMs("hodina")).toBeNull();
    expect(intervalToMs("01:60:00")).toBeNull();
  });
});

describe("cacheRowFresh", () => {
  it("platí uvnitř TTL a v okamžiku vypršení už ne", () => {
    expect(cacheRowFresh(row(), now)).toBe(true);
    expect(cacheRowFresh(row({ fetchedAt: "2026-11-24T11:00:00.000Z" }), now)).toBe(false);
    expect(cacheRowFresh(row({ ttlMs: 0 }), now)).toBe(false);
  });
});

describe("MemoryOemCache", () => {
  it("vrátí čerstvý řádek a po TTL už ne", async () => {
    const cache = new MemoryOemCache();
    await cache.write(row());
    expect(await cache.read("1K0615301", "allegro", now)).toEqual(row());
    expect(await cache.read("1K0615301", "allegro", new Date("2026-11-24T13:00:00.000Z"))).toBeNull();
    expect(await cache.read("JINE", "allegro", now)).toBeNull();
  });

  it("odmítne klíč, který do tabulky nesmí", async () => {
    const cache = new MemoryOemCache();
    await expect(cache.write(row({ oem: "A/B" }))).rejects.toThrow(/cacheovatelné OEM/);
  });
});
