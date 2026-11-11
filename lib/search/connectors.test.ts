import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { createAutoPartnerConnector, createInterCarsConnector } from "@/lib/search/connectors/closed";
import {
  createSupabaseStockLoader,
  matchStock,
  type StockRow,
} from "@/lib/search/connectors/internal-stock";
import { createAutodocConnector, createBPartsConnector, createOvokoConnector } from "@/lib/search/connectors/public-pages";
import { PoliteFetch, SEARCH_USER_AGENT } from "@/lib/search/polite-fetch";
import type { SupplierSearchQuery } from "@/lib/search/types";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");
}

const query = (overrides: Partial<SupplierSearchQuery> = {}): SupplierSearchQuery => ({
  oemNumber: "1K0615301",
  vehicle: null,
  category: null,
  rawQuery: null,
  queryType: "catalog",
  ...overrides,
});

function routed(handler: (url: string) => Response) {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    const headers = new Headers(init?.headers);
    expect(headers.get("user-agent")).toBe(SEARCH_USER_AGENT);
    expect(headers.get("authorization")).toBeNull();
    return handler(url);
  };
  return { calls, fetchImpl };
}

describe("konektory veřejných stránek", () => {
  it("Ovoko při challenge vrátí prázdno a podruhé už stránku nestahuje", async () => {
    const { calls, fetchImpl } = routed((url) => {
      if (url === "https://rrr.lt/robots.txt") return new Response(fixture("robots/rrr.lt.txt"), { status: 200 });
      return new Response(fixture("blocks/ovoko-search-challenge.html"), {
        status: 403,
        headers: { "cf-mitigated": "challenge" },
      });
    });
    const polite = new PoliteFetch({ fetchImpl, minIntervalMs: 0 });
    const connector = createOvokoConnector(true, polite);
    const first = await connector.search(query());
    const second = await connector.search(query());
    expect(first.outcome).toBe("blocked");
    expect(first.listings).toEqual([]);
    expect(second.outcome).toBe("blocked");
    expect(calls.filter((url) => url.includes("/en/search"))).toHaveLength(1);
  });

  it("bez exact=1 se stránka RRR vůbec nevolá", async () => {
    const { calls, fetchImpl } = routed((url) => {
      if (url.endsWith("/robots.txt")) return new Response(fixture("robots/rrr.lt.txt"), { status: 200 });
      return new Response("nemělo se stáhnout", { status: 200 });
    });
    const polite = new PoliteFetch({ fetchImpl, minIntervalMs: 0 });
    const page = await polite.fetchText("ovoko", "https://rrr.lt/en/search?q=1K0615301");
    expect(page.outcome).toBe("skipped");
    expect(page.detail).toMatch(/robots.txt/);
    expect(calls).toEqual(["https://rrr.lt/robots.txt"]);
  });

  it("Autodoc skončí na challenge a nehledá uhodnutou adresu", async () => {
    const { calls, fetchImpl } = routed(() =>
      new Response(fixture("blocks/autodoc-robots-challenge.html"), {
        status: 403,
        headers: { "cf-mitigated": "challenge" },
      }),
    );
    const connector = createAutodocConnector(true, new PoliteFetch({ fetchImpl, minIntervalMs: 0 }));
    const result = await connector.search(query());
    expect(result.outcome).toBe("blocked");
    expect(result.listings).toEqual([]);
    expect(calls).toEqual(["https://www.autodoc.cz/robots.txt"]);
  });

  it("B-Parts po CloudFront 403 nevrací nabídky a blokaci si pamatuje", async () => {
    const { calls, fetchImpl } = routed((url) => {
      if (url.endsWith("/robots.txt")) return new Response(fixture("robots/b-parts.com.txt"), { status: 200 });
      return new Response(fixture("blocks/bparts-search-cloudfront-403.html"), { status: 403 });
    });
    const polite = new PoliteFetch({ fetchImpl, minIntervalMs: 0 });
    const connector = createBPartsConnector(true, polite);
    expect((await connector.search(query())).outcome).toBe("blocked");
    expect((await connector.search(query())).listings).toEqual([]);
    expect(calls).toEqual([
      "https://www.b-parts.com/robots.txt",
      "https://www.b-parts.com/auto-parts/search",
    ]);
  });

  it("vypnutý zdroj ani síť nezavolá", async () => {
    const { calls, fetchImpl } = routed(() => new Response("no", { status: 500 }));
    const result = await createOvokoConnector(false, new PoliteFetch({ fetchImpl })).search(query());
    expect(result.outcome).toBe("skipped");
    expect(calls).toEqual([]);
  });
});

describe("zdroje bez veřejného API", () => {
  it("Inter Cars a Auto Partner nic nestahují", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = () => {
      throw new Error("síť se volat neměla");
    };
    try {
      const inter = await createInterCarsConnector(true).search(query());
      const partner = await createAutoPartnerConnector(true).search(query());
      expect(inter.outcome).toBe("skipped");
      expect(inter.listings).toEqual([]);
      expect(inter.detail).toMatch(/robots.txt/);
      expect(partner.outcome).toBe("skipped");
      expect(partner.detail).toMatch(/Přihlášení nemáme/);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("vlastní sklad", () => {
  const row = (overrides: Partial<StockRow> = {}): StockRow => ({
    id: "item-1",
    titleCs: "Brzdový kotouč",
    oemNumber: "1K0 615 301",
    partCategory: "Brzdy",
    vehicleCompatibility: [{ model: "Octavia" }],
    costPriceCzk: 200,
    stockQuantity: 2,
    images: ["/sklad/kotouc.jpg"],
    internalProjectTag: "damedily",
    partCondition: "pouzity",
    originKind: "oem",
    conditionDetail: "Drobné stopy po provozu.",
    ...overrides,
  });

  it("spáruje OEM bez mezer a kus bez stavu vynechá", () => {
    const rows = [row(), row({ id: "item-2", partCondition: null })];
    expect(matchStock(rows, query()).map((item) => item.id)).toEqual(["item-1"]);
    expect(matchStock(rows, query({ oemNumber: null, category: "Brzdy", vehicle: "Octavia" }))).toHaveLength(1);
  });

  it("ze Supabase vezme jen řádky dotazu a nákupní cena zůstane na serveru", async () => {
    const seen: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      seen.push(String(input));
      return Response.json([
        {
          id: "item-1",
          title_cs: "Brzdový kotouč",
          oem_number: "1K0615301",
          part_category: "Brzdy",
          vehicle_compatibility: [],
          cost_price_czk: "200.00",
          stock_quantity: 2,
          images: [],
          internal_project_tag: "damedily",
          part_condition: "novy",
          origin_kind: "druhovyroba",
        },
      ]);
    };
    const rows = await createSupabaseStockLoader(
      { SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: "service-secret" },
      fetchImpl,
    )(query());
    expect(seen[0]).toContain("oem_compact=eq.1K0615301");
    expect(rows[0]?.costPriceCzk).toBe(200);
    expect(rows[0]?.partCondition).toBe("novy");
    expect(JSON.stringify(seen)).not.toContain("service-secret");
  });
});
