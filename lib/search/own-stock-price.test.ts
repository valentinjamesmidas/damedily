import { describe, expect, it } from "vitest";

import { createInventoryConnector, createSupabaseStockLoader } from "@/lib/search/connectors/internal-stock";
import { ImageLinkStore } from "@/lib/search/images";
import { createMemorySessionRecorder } from "@/lib/search/sessions";
import { handleSearchPost } from "@/lib/search/stream";

const COST = 800;
const SELLING = 1000;

function containsCost(value: unknown): boolean {
  if (value === COST || value === String(COST) || value === `${COST}.00`) return true;
  if (typeof value === "number" && Object.is(value, COST)) return true;
  if (typeof value === "string" && value.includes(String(COST))) return true;
  if (Array.isArray(value)) return value.some((item) => containsCost(item));
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).some(
      ([key, item]) => key.includes(String(COST)) || containsCost(item),
    );
  }
  return false;
}

describe("prodejní cena vlastního skladu", () => {
  it("do streamu dá uloženou prodejní cenu a nákupní cenu v nabídce nenechá", async () => {
    const seen: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      seen.push(String(input));
      return Response.json([
        {
          id: "11111111-1111-4111-8111-111111111111",
          title_cs: "Rameno nápravy",
          oem_number: "1K0615301",
          part_category: "Podvozek",
          vehicle_compatibility: [],
          cost_price_czk: `${COST}.00`,
          selling_price_czk: `${SELLING}.00`,
          stock_quantity: 1,
          images: [],
          internal_project_tag: "damedily",
          part_condition: "pouzity",
          origin_kind: "oem",
          condition_detail: "Drobné stopy po provozu.",
          source: "vlastni_sklad",
        },
      ]);
    };

    const connector = createInventoryConnector(
      true,
      createSupabaseStockLoader(
        { SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: "service-secret" },
        fetchImpl,
      ),
    );
    const response = await handleSearchPost(
      new Request("http://127.0.0.1/api/search/stream", {
        method: "POST",
        body: JSON.stringify({ oemNumber: "1K0615301", queryType: "catalog" }),
      }),
      {
        connectors: [connector],
        rates: async () => ({ source: "cnb", validFor: "2026-11-24", czkPerUnit: { CZK: 1 } }),
        translate: async () => null,
        images: new ImageLinkStore(),
        sessions: createMemorySessionRecorder(),
        firstBudgetMs: 1_000,
        restBudgetMs: 1_000,
        rank: async () => null,
        sleep: () => new Promise((resolve) => setTimeout(resolve, 0)),
        userId: null,
      },
    );

    expect(response.status).toBe(200);
    const events = (await response.text())
      .trim()
      .split("\n\n")
      .filter(Boolean)
      .map((block) => JSON.parse(block.replace(/^data:\s*/, "")) as { type?: string; offer?: unknown });
    const offers = events.filter((event) => event.type === "offer").map((event) => event.offer);
    expect(offers).toHaveLength(1);
    expect((offers[0] as { sellingPriceCzk: number }).sellingPriceCzk).toBe(SELLING);
    expect(containsCost(offers[0])).toBe(false);
    expect(JSON.stringify(events)).not.toContain(String(COST));
    expect(seen[0]).toContain("selling_price_czk");
    expect(seen[0]).not.toContain("cost_price_czk");
  });
});
