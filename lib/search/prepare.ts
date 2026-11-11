import { createHash } from "node:crypto";

import type { ListingNormalization } from "@/lib/ai-schemas";
import { TtlCache } from "@/lib/search/cache";
import { convertToCzk, type RateTable } from "@/lib/search/currency";
import { ImageLinkStore } from "@/lib/search/images";
import type { PreparedOffer } from "@/lib/search/rank";
import type { SupplierListing } from "@/lib/search/types";
import { normalizeListing } from "@/lib/dilobot";
import type { XaiClient } from "@/lib/xai-grok";
import { toPublicOffer, type ProjectTag } from "@/lib/white-label";

export function listingSourceText(listing: SupplierListing): string {
  return [
    listing.title,
    listing.description,
    listing.conditionDetail,
    listing.oemNumber ? `OEM: ${listing.oemNumber}` : null,
  ]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join("\n");
}

export function createListingTranslator(
  client: XaiClient | null,
  cache: TtlCache,
  ttlMs = 30 * 24 * 60 * 60 * 1000,
): (listing: SupplierListing) => Promise<ListingNormalization | null> {
  return async (listing) => {
    if (!client || listing.sourcePlatform === "internal_stock") return null;
    const text = listingSourceText(listing);
    if (!text) return null;
    const key = `tr:v1:${createHash("sha256").update(text).digest("hex")}`;
    const hit = cache.get<ListingNormalization>(key);
    if (hit) return hit;
    try {
      const normalized = await normalizeListing(client, text);
      cache.set(key, normalized, ttlMs);
      return normalized;
    } catch {
      return null;
    }
  };
}

function conditionLabel(condition: "pouzity" | "novy"): string {
  return condition === "pouzity" ? "Použitý" : "Nový";
}

/**
 * Přeloží, převede cenu a postaví veřejnou nabídku.
 * Když chybí stav, kurz nebo z textu po vyčištění nic nezbyde, položku zahodí.
 */
export async function prepareListings(input: {
  listings: readonly SupplierListing[];
  rates: RateTable | null;
  translate: (listing: SupplierListing) => Promise<ListingNormalization | null>;
  images: ImageLinkStore;
  projectTag: ProjectTag;
}): Promise<PreparedOffer[]> {
  const prepared: PreparedOffer[] = [];
  const seen = new Set<string>();

  for (const listing of input.listings) {
    const id = `${listing.sourcePlatform}:${listing.externalId}`;
    if (seen.has(id)) continue;
    const costPriceCzk =
      listing.currency.toUpperCase() === "CZK"
        ? convertToCzk(listing.price, "CZK", { source: "cnb", validFor: "", czkPerUnit: { CZK: 1 } })
        : input.rates
          ? convertToCzk(listing.price, listing.currency, input.rates)
          : null;
    if (costPriceCzk === null) continue;

    const translated = await input.translate(listing);
    const condition = listing.condition ?? translated?.condition ?? null;
    if (!condition) continue;
    const titleCs = translated?.titleCs?.trim() || listing.title;
    const descriptionCs = translated ? translated.descriptionCs : listing.description;
    const conditionDetail =
      listing.conditionDetail?.trim() || translated?.conditionDetail?.trim() || conditionLabel(condition);
    const originKind = listing.originKind ?? translated?.originKind ?? null;
    const oemNumber = listing.oemNumber ?? translated?.oemNumber ?? null;
    const images = [
      ...listing.imageUrls.filter((url) => url.startsWith("/")),
      ...listing.imageUrls
        .filter((url) => url.startsWith("https://"))
        .map((url) => input.images.publish(url))
        .filter((url): url is string => Boolean(url)),
    ];

    try {
      const offer = toPublicOffer({
        titleCs,
        descriptionCs,
        oemNumber,
        condition,
        conditionDetail,
        originKind,
        sourcePlatform: listing.sourcePlatform,
        costPriceCzk,
        internalProjectTag: listing.internalProjectTag ?? input.projectTag,
        images,
      });
      seen.add(id);
      prepared.push({
        id,
        sourcePlatform: listing.sourcePlatform,
        oemNumber: offer.oemNumber,
        condition: offer.condition,
        originKind,
        category: listing.category,
        sellingPriceCzk: offer.sellingPriceCzk,
        offer,
      });
    } catch {
      // Text po vyčištění nezbylo co zveřejnit, nebo cena nedává smysl.
    }
  }

  return prepared;
}
