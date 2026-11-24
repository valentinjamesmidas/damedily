import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sellingPrice } from "@/lib/pricing";
import { toPublicOffer } from "@/lib/white-label";
import { ALLEGRO_LISTING_URL, ALLEGRO_TOKEN_URL, createAllegroSource } from "./allegro";
import { normalizeOem } from "./oem";
import { purchasePriceReachedPublicOffer } from "./public-boundary";
import { isSourceOffer, type PartSource, type SourceOffer } from "./types";

const RAW_OEM = "1k0 615.301-ab";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/allegro/${name}`, import.meta.url)), "utf8");
}

function jsonResponse(body: string, contentType: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": contentType } });
}

function createFake(enabled: boolean): PartSource {
  return {
    id: "fake",
    async health() {
      return enabled ? { ok: true, detail: "zapnuto" } : { ok: false, detail: "vypnuto" };
    },
    async searchByOem(oem: string): Promise<SourceOffer[]> {
      if (!enabled) return [];
      const normalized = normalizeOem(oem);
      if (!normalized) return [];
      return [
        {
          source: "fake",
          oem: normalized,
          name: "Rameno",
          condition: "used",
          price: { amount: 80, currency: "PLN" },
          availability: "2",
          url: "https://example.test/offer/1",
          fetchedAt: "2026-11-24T12:00:00.000Z",
        },
      ];
    },
  };
}

function createAllegro(enabled: boolean): PartSource {
  if (!enabled) {
    return createAllegroSource({
      env: {},
      fetchImpl: async () => {
        throw new Error("síť");
      },
    });
  }
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url === ALLEGRO_TOKEN_URL) return jsonResponse(fixture("token.json"), "application/json");
    const parsed = new URL(url);
    if (`${parsed.origin}${parsed.pathname}` !== ALLEGRO_LISTING_URL) throw new Error(`neočekávaná adresa ${url}`);
    const filter = parsed.searchParams.get("parameter.11323");
    if (filter === "11323_2") return jsonResponse(fixture("listing-used.json"), "application/vnd.allegro.public.v1+json");
    if (filter === "11323_9") {
      return jsonResponse(fixture("listing-aftermarket.json"), "application/vnd.allegro.public.v1+json");
    }
    if (filter) return jsonResponse('{"items":{"promoted":[],"regular":[]}}', "application/json");
    return jsonResponse(fixture("listing-filters.json"), "application/vnd.allegro.public.v1+json");
  };
  return createAllegroSource({
    env: { ALLEGRO_CLIENT_ID: "client", ALLEGRO_CLIENT_SECRET: "secret" },
    fetchImpl,
    now: () => new Date("2026-11-24T12:00:00.000Z"),
  });
}

function definePartSourceContract(label: string, create: (enabled: boolean) => PartSource): void {
  describe(`smlouva PartSource: ${label}`, () => {
    it("má id, health a při vypnutí vrátí prázdno", async () => {
      const enabled = create(true);
      const disabled = create(false);
      expect(enabled.id).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(disabled.id).toBe(enabled.id);
      const up = await enabled.health();
      const down = await disabled.health();
      expect(up.ok).toBe(true);
      expect(up.detail.length).toBeGreaterThan(0);
      expect(down.ok).toBe(false);
      expect(down.detail.length).toBeGreaterThan(0);
      expect(await disabled.searchByOem(RAW_OEM)).toEqual([]);
      expect(await disabled.searchByOem(" . - ")).toEqual([]);
    });

    it("vrátí normalizované nabídky a nákupní cenu nenechá ve veřejné nabídce", async () => {
      const source = create(true);
      expect(await source.searchByOem(" . - ")).toEqual([]);
      const offers = await source.searchByOem(RAW_OEM);
      expect(offers.length).toBeGreaterThan(0);
      for (const offer of offers) {
        expect(isSourceOffer(offer)).toBe(true);
        expect(offer.source).toBe(source.id);
        expect(offer.oem).toBe(normalizeOem(RAW_OEM));
        expect(offer.condition === "used" || offer.condition === "aftermarket").toBe(true);
        expect(offer.availability).toMatch(/^[0-9]+$/);
        expect(offer.url.startsWith("https://")).toBe(true);
        const published = toPublicOffer({
          titleCs: "Rameno nápravy",
          condition: offer.condition === "used" ? "pouzity" : "novy",
          conditionDetail: "Stav je v podkladu uvedený.",
          originKind: offer.condition === "used" ? "oem" : "druhovyroba",
          sourcePlatform: "autodoc",
          costPriceCzk: offer.price.amount,
          oemNumber: offer.oem,
        });
        expect(published.sellingPriceCzk).toBe(sellingPrice(offer.price.amount));
        expect(published.sellingPriceCzk).not.toBe(offer.price.amount);
        expect(purchasePriceReachedPublicOffer(published, offer.price)).toBe(false);
      }
    });
  });
}

definePartSourceContract("testovací zdroj", createFake);
definePartSourceContract("Allegro", createAllegro);
