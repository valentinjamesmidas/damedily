import { describe, expect, it } from "vitest";
import { sellingPrice } from "@/lib/pricing";
import { serializePublicOffer, toPublicOffer, type PublicOffer } from "@/lib/white-label";
import { purchasePriceReachedPublicOffer } from "./public-boundary";
import type { SourceOffer } from "./types";

type PurchaseKey =
  | "price"
  | "costPrice"
  | "costPriceCzk"
  | "cost_price"
  | "cost_price_czk"
  | "purchasePrice"
  | "purchase_price";

type PublicOfferLeak = Extract<keyof PublicOffer, PurchaseKey>;
const publicOfferHasNoPurchasePrice: PublicOfferLeak extends never ? true : never = true;

const purchase = { amount: 123.45, currency: "PLN" };

const sourceOffer: SourceOffer = {
  source: "allegro",
  oem: "1K0615301",
  name: "Wahacz",
  condition: "used",
  price: purchase,
  availability: "3",
  url: "https://allegro.pl/oferta/10000000001",
  fetchedAt: "2026-11-24T12:00:00.000Z",
};

function publishedFromCost(costPriceCzk: number, sellingPriceCzk?: number): PublicOffer {
  return toPublicOffer({
    titleCs: "Rameno nápravy",
    descriptionCs: null,
    oemNumber: sourceOffer.oem,
    condition: "pouzity",
    conditionDetail: "Drobné stopy po provozu, bez prasklin.",
    originKind: "oem",
    sourcePlatform: "autodoc",
    costPriceCzk,
    sellingPriceCzk,
  });
}

describe("nákupní cena a PublicOffer", () => {
  it("typ veřejné nabídky nákupní cenu nemá", () => {
    expect(publicOfferHasNoPurchasePrice).toBe(true);
  });

  it("částka ze SourceOffer se po marži ve veřejné nabídce neobjeví", () => {
    const offer = publishedFromCost(sourceOffer.price.amount);
    expect(offer.sellingPriceCzk).toBe(sellingPrice(sourceOffer.price.amount));
    expect(offer.sellingPriceCzk).toBe(190);
    expect(offer.sellingPriceCzk).not.toBe(sourceOffer.price.amount);
    expect(purchasePriceReachedPublicOffer(offer, sourceOffer.price)).toBe(false);

    const serialized = serializePublicOffer(offer);
    expect(serialized).not.toContain("123.45");
    expect(serialized).not.toContain("PLN");
    expect(serialized).not.toContain("allegro");
    const keys = Object.keys(JSON.parse(serialized) as Record<string, unknown>);
    expect(keys).not.toContain("price");
    expect(keys).not.toContain("costPriceCzk");
    expect(keys).not.toContain("purchasePrice");
  });

  it("odhalí nákupní částku zkopírovanou do prodejní ceny", () => {
    const copied = publishedFromCost(10, sourceOffer.price.amount);
    expect(copied.sellingPriceCzk).toBe(sourceOffer.price.amount);
    expect(purchasePriceReachedPublicOffer(copied, sourceOffer.price)).toBe(true);
  });

  it("serializér klíč price z veřejného JSON vynechá", () => {
    const offer = publishedFromCost(sourceOffer.price.amount);
    const poisoned = { ...offer, price: sourceOffer.price, costPriceCzk: sourceOffer.price.amount };
    const serialized = serializePublicOffer(poisoned);
    expect(serialized).not.toContain("123.45");
    expect(serialized).not.toContain("PLN");
    expect(JSON.parse(serialized)).not.toHaveProperty("price");
  });
});
