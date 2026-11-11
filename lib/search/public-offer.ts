import type { PublicOffer } from "@/lib/white-label";

export type ClientSearchQuery = {
  oemNumber: string | null;
  vehicle: string | null;
  category: string | null;
  rawQuery: string | null;
  queryType: "chat" | "catalog" | "photo";
};

const CONDITIONS = new Set(["pouzity", "novy"]);
const ORIGINS = new Set(["oem", "druhovyroba", "neuvedeno"]);

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Z události streamu vezme jen veřejná pole nabídky. */
export function readPublicOffer(value: unknown): PublicOffer | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const condition = row.condition;
  const origin = row.originKind;
  const price = typeof row.sellingPriceCzk === "number" ? row.sellingPriceCzk : Number(row.sellingPriceCzk);
  if (typeof condition !== "string" || !CONDITIONS.has(condition)) return null;
  if (typeof origin !== "string" || !ORIGINS.has(origin)) return null;
  if (!Number.isFinite(price) || price < 0) return null;
  const titleCs = text(row.titleCs);
  const conditionDetail = text(row.conditionDetail);
  const deliveryLeadTime = text(row.deliveryLeadTime);
  const warehouseLabel = text(row.warehouseLabel);
  if (!titleCs || !conditionDetail || !deliveryLeadTime || !warehouseLabel) return null;
  const conditionLabel = condition === "pouzity" ? "Použitý" : "Nový";
  const originLabel = origin === "oem" ? "OEM" : origin === "druhovyroba" ? "Druhovýroba" : "V podkladu neuvedeno";
  return {
    titleCs,
    descriptionCs: text(row.descriptionCs),
    oemNumber: text(row.oemNumber),
    condition: condition as PublicOffer["condition"],
    conditionLabel,
    conditionDetail,
    originKind: origin as PublicOffer["originKind"],
    originLabel,
    warehouseLabel,
    sellingPriceCzk: price,
    deliveryLeadTime,
    images: Array.isArray(row.images) ? row.images.filter((image): image is string => typeof image === "string" && image.startsWith("/")) : [],
  };
}

export type OfferEvent = { phase: "first" | "alternative"; offer: PublicOffer };

export function readOfferEvent(value: unknown): OfferEvent | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (row.type !== "offer") return null;
  if (row.phase !== "first" && row.phase !== "alternative") return null;
  const offer = readPublicOffer(row.offer);
  if (!offer) return null;
  return { phase: row.phase, offer };
}

export function readStreamError(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (row.type !== "error") return null;
  return text(row.message) ?? "Hledání se nepodařilo dokončit.";
}

export function isStreamCompleted(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return row.type === "status" && row.status === "completed";
}

export function takeSseEvents(buffer: string): { events: unknown[]; rest: string } {
  const chunks = buffer.split("\n\n");
  const rest = chunks.pop() ?? "";
  const events: unknown[] = [];
  for (const chunk of chunks) {
    const line = chunk
      .split("\n")
      .map((item) => item.trim())
      .find((item) => item.startsWith("data:"));
    if (!line) continue;
    try {
      events.push(JSON.parse(line.slice(5).trim()));
    } catch {
      // Rozbitou událost přeskočíme, další nabídky zůstanou.
    }
  }
  return { events, rest };
}
