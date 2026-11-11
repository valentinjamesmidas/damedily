import { describe, expect, it } from "vitest";

import { createAutoPartnerConnector, createInterCarsConnector } from "@/lib/search/connectors/closed";
import { createAutodocConnector, createBPartsConnector, createOvokoConnector } from "@/lib/search/connectors/public-pages";
import { ExchangeRateService } from "@/lib/search/currency";
import { PoliteFetch } from "@/lib/search/polite-fetch";
import type { ConnectorResult, SupplierSearchQuery } from "@/lib/search/types";

const query: SupplierSearchQuery = {
  oemNumber: "1K0615301",
  vehicle: null,
  category: "Brzdy",
  rawQuery: null,
  queryType: "catalog",
};

describe("jednorázový živý dotaz", () => {
  it("zapíše, co zdroje opravdu vrátily", async () => {
    const polite = new PoliteFetch({ minIntervalMs: 0, timeoutMs: 12_000 });
    const connectors = [
      createOvokoConnector(true, polite),
      createBPartsConnector(true, polite),
      createAutodocConnector(true, polite),
      createInterCarsConnector(true),
      createAutoPartnerConnector(true),
    ];
    const results: ConnectorResult[] = [];
    for (const connector of connectors) {
      results.push(await connector.search(query));
    }
    const rates = await new ExchangeRateService({ timeoutMs: 12_000 }).table();

    const report = {
      checkedAt: new Date().toISOString(),
      query: query.oemNumber,
      rates: rates
        ? { source: rates.source, validFor: rates.validFor, eur: rates.czkPerUnit.EUR }
        : null,
      sources: results.map((result) => ({
        source: result.source,
        outcome: result.outcome,
        detail: result.detail,
        listings: result.listings.length,
      })),
    };
    console.log(JSON.stringify(report, null, 2));

    for (const result of results) {
      expect(result.listings.every((listing) => listing.price >= 0 && listing.title.trim())).toBe(true);
    }
    expect(results.find((result) => result.source === "inter_cars")?.listings).toEqual([]);
    expect(results.find((result) => result.source === "auto_partner")?.listings).toEqual([]);
    expect(rates?.czkPerUnit.EUR).toBeGreaterThan(10);
  });
});
