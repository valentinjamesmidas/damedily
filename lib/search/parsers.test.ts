import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { detectPublicBlock } from "@/lib/search/block";
import { listingsFromJsonLd } from "@/lib/search/jsonld";
import { robotsAllows, robotsRulesFor } from "@/lib/search/robots";
import { SEARCH_USER_AGENT } from "@/lib/search/polite-fetch";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");
}

describe("robots.txt uložené ze zdrojů", () => {
  it("na RRR povolí hledání s exact=1 a zakáže API i dotaz bez exact", () => {
    const rules = robotsRulesFor(fixture("robots/rrr.lt.txt"), SEARCH_USER_AGENT);
    expect(robotsAllows(rules, "/en/search?q=1K0615301&exact=1")).toBe(true);
    expect(robotsAllows(rules, "/en/search?q=1K0615301")).toBe(false);
    expect(robotsAllows(rules, "/api/search")).toBe(false);
  });

  it("na Inter Cars zakáže veřejné hledání", () => {
    const rules = robotsRulesFor(fixture("robots/intercars.cz.txt"), SEARCH_USER_AGENT);
    expect(robotsAllows(rules, "/vyhledavani/q=brzdy")).toBe(false);
    expect(robotsAllows(rules, "/")).toBe(true);
  });

  it("na B-Parts povolí stránku hledání a zakáže /api", () => {
    const rules = robotsRulesFor(fixture("robots/b-parts.com.txt"), SEARCH_USER_AGENT);
    expect(robotsAllows(rules, "/auto-parts/search")).toBe(true);
    expect(robotsAllows(rules, "/api/catalog")).toBe(false);
    expect(robotsAllows(rules, "/en/shop/cart")).toBe(false);
  });
});

describe("uložené blokace", () => {
  it("pozná Cloudflare challenge z Ovoka a Autodocu", () => {
    expect(detectPublicBlock(403, fixture("blocks/ovoko-search-challenge.html"), "challenge")).toBe(
      "cloudflare-challenge",
    );
    expect(detectPublicBlock(403, fixture("blocks/autodoc-robots-challenge.html"), "challenge")).toBe(
      "cloudflare-challenge",
    );
  });

  it("pozná CloudFront 403 z B-Parts", () => {
    expect(detectPublicBlock(403, fixture("blocks/bparts-search-cloudfront-403.html"), null)).toBe(
      "cloudfront-block",
    );
  });

  it("ze stránky s blokací neudělá nabídku", () => {
    expect(
      listingsFromJsonLd(fixture("blocks/ovoko-search-challenge.html"), "https://rrr.lt/en/search", "ovoko"),
    ).toEqual([]);
  });
});

describe("JSON-LD parser", () => {
  it("vezme jen údaje, které ve strukturovaném bloku jsou", () => {
    const [listing] = listingsFromJsonLd(
      fixture("html/jsonld-product.html"),
      "https://example.test/search",
      "ovoko",
    );
    expect(listing).toMatchObject({
      sourcePlatform: "ovoko",
      title: "Front brake disc",
      oemNumber: "1K0615301",
      condition: "pouzity",
      originKind: null,
      price: 40,
      currency: "EUR",
      imageUrls: ["https://cdn.example/disc.jpg"],
      supplierLeadTime: null,
      category: "Brakes",
    });
  });
});
