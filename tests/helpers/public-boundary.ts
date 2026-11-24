import { sellingPrice } from "@/lib/pricing";
import { serializePublicOffer, type PublicOffer } from "@/lib/white-label";

/** Názvy, pod kterými by nákupní cena mohla utéct do JSON pro zákazníka. */
export const PURCHASE_PRICE_KEYS = [
  "price",
  "costPrice",
  "costPriceCzk",
  "cost_price",
  "cost_price_czk",
  "purchasePrice",
  "purchase_price",
] as const;

function containsJsonNumber(serialized: string, amount: number): boolean {
  const token = JSON.stringify(amount).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\d.])${token}(?![\\d.])`).test(serialized);
}

/**
 * True, když se částka nebo měna z ceníku zdroje objeví ve veřejné nabídce,
 * nebo když serializér vypíše klíč nákupní ceny.
 * Prodejní cena dopočítaná přes `sellingPrice` sama o sobě únik není.
 */
export function purchasePriceReachedPublicOffer(
  offer: PublicOffer,
  purchase: { amount: number; currency: string },
): boolean {
  const serialized = serializePublicOffer(offer);
  const parsed: unknown = JSON.parse(serialized);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return true;
  const record = parsed as Record<string, unknown>;
  if (PURCHASE_PRICE_KEYS.some((key) => key in record)) return true;
  if (Object.values(record).some((value) => value === purchase.currency)) return true;
  if (purchase.amount !== sellingPrice(purchase.amount) && containsJsonNumber(serialized, purchase.amount)) {
    return true;
  }
  return false;
}
