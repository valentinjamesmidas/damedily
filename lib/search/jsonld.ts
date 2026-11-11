import type { SupplierListing } from "@/lib/search/types";
import type { SourcePlatform } from "@/lib/white-label";

type Parsed = Omit<SupplierListing, "sourcePlatform" | "supplierLeadTime" | "originKind"> & {
  originKind: null;
  supplierLeadTime: null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asText(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function asPrice(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const price = Number(normalized);
  return Number.isFinite(price) ? price : null;
}

function conditionFromSchema(value: unknown): "pouzity" | "novy" | null {
  const text = asText(value)?.toLowerCase();
  if (!text) return null;
  if (text.includes("usedcondition")) return "pouzity";
  if (text.includes("newcondition")) return "novy";
  return null;
}

function imagesFrom(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function offerPrice(offers: unknown): { price: number; currency: string } | null {
  const offer = Array.isArray(offers) ? offers.find(isRecord) : offers;
  if (!isRecord(offer)) return null;
  const price = asPrice(offer.price) ?? asPrice(offer.lowPrice);
  const currency = asText(offer.priceCurrency)?.toUpperCase() ?? "";
  if (price === null || !/^[A-Z]{3}$/.test(currency)) return null;
  return { price, currency };
}

function productFrom(node: Record<string, unknown>, pageUrl: string): Parsed | null {
  const types = node["@type"];
  const typeList = Array.isArray(types) ? types : [types];
  if (!typeList.some((type) => type === "Product")) return null;

  const title = asText(node.name);
  const priced = offerPrice(node.offers);
  if (!title || !priced) return null;

  const offer = Array.isArray(node.offers) ? node.offers.find(isRecord) : node.offers;
  const condition = conditionFromSchema(isRecord(offer) ? offer.itemCondition : null);
  const oem = asText(node.sku) ?? asText(node.mpn);
  const sourceUrl = asText(node.url) ?? pageUrl;
  return {
    externalId: oem ?? sourceUrl,
    sourceUrl,
    title: title.slice(0, 300),
    description: asText(node.description)?.slice(0, 2_000) ?? null,
    oemNumber: oem?.slice(0, 40) ?? null,
    condition,
    conditionDetail: null,
    originKind: null,
    price: priced.price,
    currency: priced.currency,
    imageUrls: imagesFrom(node.image).filter((url) => url.startsWith("https://")),
    supplierLeadTime: null,
    category: asText(node.category),
  };
}

function walk(node: unknown, pageUrl: string, output: Parsed[], depth: number): void {
  if (depth > 8 || output.length >= 20) return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, pageUrl, output, depth + 1);
    return;
  }
  if (!isRecord(node)) return;

  const product = productFrom(node, pageUrl);
  if (product) output.push(product);

  if (Array.isArray(node["@graph"])) walk(node["@graph"], pageUrl, output, depth + 1);
  if (Array.isArray(node.itemListElement)) {
    for (const element of node.itemListElement) {
      if (isRecord(element) && "item" in element) walk(element.item, pageUrl, output, depth + 1);
      else walk(element, pageUrl, output, depth + 1);
    }
  }
}

/**
 * Vezme jen schema.org Product z JSON-LD. Selektor vymyšlený pro konkrétní web tu není.
 * Když ve stránce strukturovaná nabídka není, vrátí prázdné pole.
 */
export function parseJsonLdProducts(html: string, pageUrl: string): Parsed[] {
  const output: Parsed[] = [];
  const scripts = html.matchAll(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const match of scripts) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    try {
      walk(JSON.parse(raw) as unknown, pageUrl, output, 0);
    } catch {
      // Rozbitý blok není nabídka.
    }
  }
  return output;
}

export function listingsFromJsonLd(
  html: string,
  pageUrl: string,
  sourcePlatform: SourcePlatform,
): SupplierListing[] {
  return parseJsonLdProducts(html, pageUrl).map((product) => ({
    ...product,
    sourcePlatform,
  }));
}
