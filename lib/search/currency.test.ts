import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import cnbDaily from "@/lib/search/fixtures/fx/cnb-daily-2026-11-11.json";

import { sellingPrice } from "@/lib/pricing";
import {
  CNB_DAILY_URL,
  ECB_DAILY_URL,
  ExchangeRateService,
  convertToCzk,
  parseCnbDaily,
  parseEcbDaily,
} from "@/lib/search/currency";

const ecbXml = readFileSync(
  fileURLToPath(new URL("./fixtures/fx/ecb-eurofxref-daily-2026-11-10.xml", import.meta.url)),
  "utf8",
);

describe("převod měn", () => {
  it("počítá Kč z uloženého denního kurzu ČNB a prodejní cenu přes marži", () => {
    const table = parseCnbDaily(cnbDaily);
    expect(table.source).toBe("cnb");
    expect(table.validFor).toBe("2026-11-11");

    const eur = convertToCzk(10, "EUR", table);
    expect(eur).toBe(243.8);
    expect(sellingPrice(eur ?? 0)).toBe(370);

    const pln = convertToCzk(100, "PLN", table);
    expect(pln).toBe(553.5);
    expect(sellingPrice(pln ?? 0)).toBe(840);

    const huf = convertToCzk(100, "HUF", table);
    expect(huf).toBe(6.68);
    expect(sellingPrice(huf ?? 0)).toBe(20);

    expect(convertToCzk(50, "CZK", table)).toBe(50);
    expect(convertToCzk(10, "XYZ", table)).toBeNull();
  });

  it("z uloženého kurzu ECB převede přes CZK za euro", () => {
    const table = parseEcbDaily(ecbXml);
    expect(table.source).toBe("ecb");
    expect(table.validFor).toBe("2026-11-10");
    expect(convertToCzk(1, "EUR", table)).toBe(24.34);
    expect(convertToCzk(10, "USD", table)).toBe(217.02);
  });

  it("při výpadku ČNB vezme ECB a podruhé už síť nevolá", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url === CNB_DAILY_URL) return new Response("no", { status: 503 });
      if (url === ECB_DAILY_URL) return new Response(ecbXml, { status: 200 });
      return new Response("missing", { status: 404 });
    };
    const service = new ExchangeRateService({ fetchImpl, now: () => 1_000, ttlMs: 50 });
    const first = await service.table();
    const second = await service.table();
    expect(first?.source).toBe("ecb");
    expect(second?.validFor).toBe(first?.validFor);
    expect(calls).toEqual([CNB_DAILY_URL, ECB_DAILY_URL]);
  });
});
