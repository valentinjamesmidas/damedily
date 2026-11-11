import { offerRankingSchema, type OfferRanking } from "@/lib/ai-schemas";
import { oemEqual } from "@/lib/search/oem";
import type { SupplierSearchQuery } from "@/lib/search/types";
import { OFFER_RANKING_PROMPT } from "@/lib/prompts/ranking";
import type { XaiClient } from "@/lib/xai-grok";
import type { PartCondition, PartOriginKind, PublicOffer, SourcePlatform } from "@/lib/white-label";

export type PreparedOffer = {
  id: string;
  sourcePlatform: SourcePlatform;
  oemNumber: string | null;
  condition: PartCondition;
  originKind: Exclude<PartOriginKind, "neuvedeno"> | null;
  category: string | null;
  sellingPriceCzk: number;
  offer: PublicOffer;
};

function normalizeText(value: string): string {
  return value.trim().toLocaleLowerCase("cs-CZ");
}

/** Plná shoda: známý stav a buď stejné OEM, nebo stejná kategorie, nebo textový dotaz konektoru. */
export function isFullMatch(query: SupplierSearchQuery, item: PreparedOffer): boolean {
  if (query.oemNumber) return oemEqual(item.oemNumber, query.oemNumber);
  if (query.category) {
    if (!item.category) return false;
    return normalizeText(item.category) === normalizeText(query.category);
  }
  return Boolean(query.vehicle || query.rawQuery);
}

function byPrice(left: PreparedOffer, right: PreparedOffer): number {
  const price = left.sellingPriceCzk - right.sellingPriceCzk;
  if (price !== 0) return price;
  if (left.sourcePlatform === "internal_stock" && right.sourcePlatform !== "internal_stock") return -1;
  if (right.sourcePlatform === "internal_stock" && left.sourcePlatform !== "internal_stock") return 1;
  return left.id.localeCompare(right.id);
}

export function selectFirst(items: readonly PreparedOffer[], query: SupplierSearchQuery): PreparedOffer | null {
  const matches = items.filter((item) => isFullMatch(query, item)).sort(byPrice);
  return matches[0] ?? null;
}

function ruleAlternatives(pool: readonly PreparedOffer[], firstId: string): PreparedOffer[] {
  const rest = pool.filter((item) => item.id !== firstId);
  const usedOem = rest
    .filter((item) => item.condition === "pouzity" && item.originKind === "oem")
    .sort(byPrice);
  const newAftermarket = rest
    .filter((item) => item.condition === "novy" && item.originKind === "druhovyroba")
    .sort(byPrice);
  const picked: PreparedOffer[] = [];
  if (usedOem[0]) picked.push(usedOem[0]);
  if (newAftermarket[0] && !picked.some((item) => item.id === newAftermarket[0].id)) {
    picked.push(newAftermarket[0]);
  }
  for (const item of [...rest].sort(byPrice)) {
    if (picked.length >= 2) break;
    if (!picked.some((chosen) => chosen.id === item.id)) picked.push(item);
  }
  return picked.slice(0, 2);
}

/**
 * První díl je vždy nejlevnější plná shoda.
 * Dvě alternativy bere z modelu, a když model selže nebo vrátí neznámé id, z pravidel.
 */
export function selectAlternatives(
  items: readonly PreparedOffer[],
  query: SupplierSearchQuery,
  first: PreparedOffer,
  preferredIds: readonly string[] | null,
): PreparedOffer[] {
  const pool = items.filter((item) => isFullMatch(query, item));
  const rules = ruleAlternatives(pool, first.id);
  if (!preferredIds) return rules;

  const byId = new Map(pool.filter((item) => item.id !== first.id).map((item) => [item.id, item]));
  const picked: PreparedOffer[] = [];
  for (const id of preferredIds) {
    const item = byId.get(id);
    if (!item || picked.some((chosen) => chosen.id === item.id)) continue;
    picked.push(item);
    if (picked.length === 2) break;
  }
  for (const item of rules) {
    if (picked.length >= 2) break;
    if (!picked.some((chosen) => chosen.id === item.id)) picked.push(item);
  }
  return picked.slice(0, 2);
}

export async function rankAlternativeIds(
  client: XaiClient,
  first: PreparedOffer,
  candidates: readonly PreparedOffer[],
): Promise<string[] | null> {
  const others = candidates.filter((item) => item.id !== first.id);
  if (others.length === 0) return [];
  try {
    const ranked: OfferRanking = await client.chatJson({
      purpose: "text",
      schema: offerRankingSchema,
      schemaName: "offer_ranking",
      temperature: 0,
      messages: [
        { role: "system", content: OFFER_RANKING_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            firstId: first.id,
            candidates: others.map((item) => ({
              id: item.id,
              condition: item.condition,
              originKind: item.originKind,
              oemNumber: item.oemNumber,
              sellingPriceCzk: item.sellingPriceCzk,
              ownStock: item.sourcePlatform === "internal_stock",
            })),
          }),
        },
      ],
    });
    return ranked.alternativeIds;
  } catch {
    return null;
  }
}
