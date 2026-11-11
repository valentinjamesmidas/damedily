import { describe, expect, it } from "vitest";

import { ImageLinkStore } from "@/lib/search/images";
import { createMemorySessionRecorder } from "@/lib/search/sessions";
import { handleSearchPost, type SearchDeps } from "@/lib/search/stream";
import type { SupplierConnector, SupplierListing } from "@/lib/search/types";
import type { SourcePlatform } from "@/lib/white-label";

const FORBIDDEN = ["ovoko", "b-parts", "bparts", "autodoc", "inter cars", "auto partner", "source_platform", "costprice", "aiscore"];

function listing(overrides: Partial<SupplierListing> & Pick<SupplierListing, "sourcePlatform" | "externalId" | "price">): SupplierListing {
  return {
    sourceUrl: "https://cdn.example/item",
    title: "Brzdový kotouč",
    description: null,
    oemNumber: "1K0615301",
    condition: "pouzity",
    conditionDetail: "Drobné stopy po provozu.",
    originKind: "oem",
    currency: "CZK",
    imageUrls: [],
    supplierLeadTime: "2 dny u zdroje",
    category: "Brzdy",
    ...overrides,
  };
}

function connector(
  source: SourcePlatform,
  listings: SupplierListing[],
  delayMs = 0,
): SupplierConnector {
  return {
    source,
    enabled: true,
    async search() {
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      return { source, listings, outcome: listings.length ? "ok" : "empty", detail: "test" };
    },
  };
}

async function readEvents(response: Response): Promise<Array<Record<string, unknown>>> {
  const text = await response.text();
  return text
    .trim()
    .split("\n\n")
    .filter(Boolean)
    .map((block) => JSON.parse(block.replace(/^data:\s*/, "")) as Record<string, unknown>);
}

function deps(overrides: Partial<SearchDeps> = {}): SearchDeps {
  return {
    connectors: [],
    rates: async () => ({ source: "cnb", validFor: "2026-11-11", czkPerUnit: { CZK: 1, EUR: 24.38 } }),
    translate: async () => null,
    images: new ImageLinkStore(),
    sessions: createMemorySessionRecorder(),
    projectTag: "damedily",
    firstBudgetMs: 1_000,
    restBudgetMs: 1_000,
    rank: async () => null,
    sleep: async () => undefined,
    userId: null,
    ...overrides,
  };
}

describe("SSE hledání", () => {
  it("hned vrátí nejlevnější shodu a pak dvě alternativy bez názvu zdroje", async () => {
    const sessions = createMemorySessionRecorder();
    const response = await handleSearchPost(
      new Request("http://127.0.0.1/api/search/stream", {
        method: "POST",
        body: JSON.stringify({ oemNumber: "1K0 615 301", queryType: "catalog" }),
      }),
      deps({
        sessions,
        connectors: [
          connector("ovoko", [
            listing({
              sourcePlatform: "ovoko",
              externalId: "cheap",
              price: 333,
              title: "Kotouč Ovoko",
              description: "Díl z B-Parts.",
              imageUrls: ["https://cdn.example/disc.jpg"],
            }),
            listing({
              sourcePlatform: "ovoko",
              externalId: "second",
              price: 400,
              title: "Druhý kotouč",
            }),
            listing({
              sourcePlatform: "autodoc",
              externalId: "new",
              price: 450,
              title: "Nový kotouč",
              condition: "novy",
              originKind: "druhovyroba",
              conditionDetail: "Nový díl v obalu.",
            }),
            listing({
              sourcePlatform: "auto_partner",
              externalId: "nameless",
              price: 100,
              title: "Auto Partner",
            }),
            listing({
              sourcePlatform: "b_parts",
              externalId: "unknown",
              price: 50,
              condition: null,
              title: "Bez stavu",
            }),
          ]),
        ],
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const events = await readEvents(response);
    expect(events.map((event) => event.type === "status" ? event.status : event.phase)).toEqual([
      "first_found",
      "first",
      "searching_alternatives",
      "alternative",
      "alternative",
      "completed",
    ]);

    const offers = events.filter((event) => event.type === "offer").map((event) => event.offer as { sellingPriceCzk: number; titleCs: string; images: string[] });
    expect(offers.map((offer) => offer.sellingPriceCzk)).toEqual([500, 600, 680]);
    expect(offers[0]?.titleCs).toBe("Kotouč");
    expect(offers[0]?.images[0]).toMatch(/^\/api\/media\//);
    expect(offers[0]?.images[0]).not.toContain("example");

    const body = JSON.stringify(events).toLowerCase();
    for (const secret of FORBIDDEN) expect(body).not.toContain(secret);
    expect(body).not.toContain("2 dny u zdroje");
    expect(body).not.toContain("https://");
    expect(sessions.statuses).toEqual(["first_found", "searching_alternatives", "completed"]);
    expect(sessions.results[2]).toHaveLength(3);
    expect(JSON.stringify(sessions.results).toLowerCase()).not.toContain("ovoko");
  });

  it("první díl nečeká na pomalý levnější zdroj a model se dá nahradit pravidly", async () => {
    const response = await handleSearchPost(
      new Request("http://127.0.0.1/api/search/stream", {
        method: "POST",
        body: JSON.stringify({ oemNumber: "1K0615301" }),
      }),
      deps({
        firstBudgetMs: 30,
        restBudgetMs: 400,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        rank: async () => {
          throw new Error("402");
        },
        connectors: [
          connector("internal_stock", [
            listing({
              sourcePlatform: "internal_stock",
              externalId: "stock",
              price: 800,
              internalProjectTag: "damedily",
            }),
          ]),
          connector(
            "b_parts",
            [listing({ sourcePlatform: "b_parts", externalId: "late", price: 100, title: "Levnější pozdě" })],
            180,
          ),
        ],
      }),
    );
    const events = await readEvents(response);
    const offers = events.filter((event) => event.type === "offer").map((event) => event.offer as { sellingPriceCzk: number });
    expect(offers.map((offer) => offer.sellingPriceCzk)).toEqual([1200, 150]);
    expect(events.filter((event) => event.type === "status").map((event) => event.status)).toEqual([
      "first_found",
      "searching_alternatives",
      "completed",
    ]);
  });

  it("když model vrátí známá id, alternativy jdou v jeho pořadí", async () => {
    const response = await handleSearchPost(
      new Request("http://127.0.0.1/api/search/stream", {
        method: "POST",
        body: JSON.stringify({ oemNumber: "1K0615301" }),
      }),
      deps({
        rank: async () => ["autodoc:new", "ovoko:second"],
        connectors: [
          connector("ovoko", [
            listing({ sourcePlatform: "ovoko", externalId: "cheap", price: 200 }),
            listing({ sourcePlatform: "ovoko", externalId: "second", price: 400 }),
          ]),
          connector("autodoc", [
            listing({
              sourcePlatform: "autodoc",
              externalId: "new",
              price: 900,
              condition: "novy",
              originKind: "druhovyroba",
            }),
          ]),
        ],
      }),
    );
    const offers = (await readEvents(response))
      .filter((event) => event.type === "offer")
      .map((event) => (event.offer as { sellingPriceCzk: number }).sellingPriceCzk);
    expect(offers).toEqual([300, 1350, 600]);
  });

  it("prázdný dotaz odmítne ještě před streamem", async () => {
    const response = await handleSearchPost(
      new Request("http://127.0.0.1/api/search/stream", { method: "POST", body: "{}" }),
      deps(),
    );
    expect(response.status).toBe(400);
  });

  it("cizí měnu přepočte kurzem a bez stavu ji nezveřejní", async () => {
    const response = await handleSearchPost(
      new Request("http://127.0.0.1/api/search/stream", {
        method: "POST",
        body: JSON.stringify({ oemNumber: "1K0615301" }),
      }),
      deps({
        connectors: [
          connector("ovoko", [
            listing({ sourcePlatform: "ovoko", externalId: "eur", price: 10, currency: "EUR" }),
            listing({ sourcePlatform: "ovoko", externalId: "no-currency", price: 10, currency: "XYZ" }),
          ]),
        ],
      }),
    );
    const events = await readEvents(response);
    const offers = events.filter((event) => event.type === "offer");
    expect(offers).toHaveLength(1);
    expect((offers[0]?.offer as { sellingPriceCzk: number }).sellingPriceCzk).toBe(370);
  });
});
