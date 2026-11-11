import { sellingPrice } from "@/lib/pricing";

/**
 * Veřejná dodací lhůta externí nabídky.
 * Právní dodatek: lhůta se uvádí pravdivě a celá. Díl z externí nabídky ještě není v ČR,
 * jede na provozovnu ke kontrole, proto 4–5 pracovních dní.
 */
export const EXTERNAL_DELIVERY_LEAD_TIME = "4–5 pracovních dní";

/**
 * Vlastní sklad už na provozovně je. Tvrdit u něj 4–5 dní by bylo nepravdivé,
 * proto má vlastní, pravdivou dostupnost.
 */
export const OWN_STOCK_AVAILABILITY = "Skladem na provozovně DámeDíly.cz";

export const SOURCE_PLATFORMS = [
  "internal_stock",
  "inter_cars",
  "auto_partner",
  "autodoc",
  "ovoko",
  "b_parts",
] as const;

export type SourcePlatform = (typeof SOURCE_PLATFORMS)[number];

export const PROJECT_TAGS = ["ekokladno", "damedily"] as const;

export type ProjectTag = (typeof PROJECT_TAGS)[number];

export type PartCondition = "pouzity" | "novy";

export type PartOriginKind = "oem" | "druhovyroba" | "neuvedeno";

/**
 * Interní označení skladu. U externích zdrojů neříká, že díl už leží v ČR,
 * a nepoužívá formulace typu „ověřený uzel“.
 */
const WAREHOUSE_LABELS: Record<SourcePlatform, string> = {
  internal_stock: "Vlastní sklad DámeDíly.cz",
  inter_cars: "Externí nabídka – Sektor A",
  auto_partner: "Externí nabídka – Sektor B",
  autodoc: "Externí nabídka – Sektor C",
  ovoko: "Externí nabídka – Sektor D",
  b_parts: "Externí nabídka – Sektor E",
};

const SUPPLIER_NAME =
  /\b(?:ovoko|b[-\s]?parts|autodoc|inter\s*cars|auto\s*partner)\b/gi;

const SCORE_PHRASE =
  /\b(?:ai\s*sk[oó]re|sk[oó]re(?:\s+ai|\s+modelu)?|jistota(?:\s+modelu)?)\s*[:：]?\s*\d+(?:[.,]\d+)?\s*%?/gi;

const FALSE_LOCATION_CLAIM =
  /v\s+čr\b|v\s+česku|české republice|už\s+leží|již\s+skladem|ověřený uzel/i;

/**
 * Veřejná nabídka. Schválně tu nejsou nákupní cena, zdroj, interní tag ani AI skóre.
 * Serializér vypisuje jen tato pole.
 */
export type PublicOffer = {
  titleCs: string;
  descriptionCs: string | null;
  oemNumber: string | null;
  condition: PartCondition;
  conditionLabel: "Použitý" | "Nový";
  conditionDetail: string;
  originKind: PartOriginKind;
  originLabel: "OEM" | "Druhovýroba" | "V podkladu neuvedeno";
  warehouseLabel: string;
  sellingPriceCzk: number;
  deliveryLeadTime: string;
};

export type OfferDraft = {
  titleCs: string;
  descriptionCs?: string | null;
  oemNumber?: string | null;
  condition: PartCondition;
  conditionDetail: string;
  originKind?: Exclude<PartOriginKind, "neuvedeno"> | null;
  sourcePlatform: SourcePlatform;
  costPriceCzk: number;
  internalProjectTag: ProjectTag;
  aiScore?: number | null;
};

const PUBLIC_OFFER_KEYS = [
  "titleCs",
  "descriptionCs",
  "oemNumber",
  "condition",
  "conditionLabel",
  "conditionDetail",
  "originKind",
  "originLabel",
  "warehouseLabel",
  "sellingPriceCzk",
  "deliveryLeadTime",
] as const satisfies readonly (keyof PublicOffer)[];

export function warehouseLabelFor(source: SourcePlatform): string {
  return WAREHOUSE_LABELS[source];
}

export function deliveryLeadTimeFor(source: SourcePlatform): string {
  return source === "internal_stock" ? OWN_STOCK_AVAILABILITY : EXTERNAL_DELIVERY_LEAD_TIME;
}

/** Vymaže z textu pro zákazníka názvy zdrojů a vypsané AI skóre. */
export function sanitizePublicText(value: string): string {
  return value
    .replace(SCORE_PHRASE, "")
    .replace(SUPPLIER_NAME, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .trim();
}

function requirePublicText(value: string, label: string): string {
  const clean = sanitizePublicText(value);
  if (!clean) {
    throw new TypeError(`${label} po odstranění interních údajů nezbylo nic, co by šlo zveřejnit.`);
  }
  return clean;
}

function optionalPublicText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const clean = sanitizePublicText(value);
  return clean || null;
}

function assertNoFalseLocationClaim(value: string, label: string): void {
  if (FALSE_LOCATION_CLAIM.test(value)) {
    throw new TypeError(`${label} tvrdí něco, co o poloze dílu nesmíme tvrdit.`);
  }
}

/**
 * Z interního návrhu udělá veřejnou nabídku.
 * Prodejní cenu počítá výhradně přes sellingPrice (marže ×1,5 nahoru na desetikoruny).
 */
export function toPublicOffer(draft: OfferDraft): PublicOffer {
  if (!SOURCE_PLATFORMS.includes(draft.sourcePlatform)) {
    throw new TypeError("Neznámý zdroj nabídky.");
  }
  if (!PROJECT_TAGS.includes(draft.internalProjectTag)) {
    throw new TypeError("Chybí platný interní tag projektu.");
  }
  if (draft.condition !== "pouzity" && draft.condition !== "novy") {
    throw new TypeError("U nabídky musí být uvedeno, zda je díl použitý, nebo nový.");
  }

  const warehouseLabel = warehouseLabelFor(draft.sourcePlatform);
  const deliveryLeadTime = deliveryLeadTimeFor(draft.sourcePlatform);
  assertNoFalseLocationClaim(warehouseLabel, "Označení skladu");
  assertNoFalseLocationClaim(deliveryLeadTime, "Dodací lhůta");

  const originKind: PartOriginKind = draft.originKind ?? "neuvedeno";
  const offer: PublicOffer = {
    titleCs: requirePublicText(draft.titleCs, "Název"),
    descriptionCs: optionalPublicText(draft.descriptionCs),
    oemNumber: optionalPublicText(draft.oemNumber),
    condition: draft.condition,
    conditionLabel: draft.condition === "pouzity" ? "Použitý" : "Nový",
    conditionDetail: requirePublicText(draft.conditionDetail, "Stav"),
    originKind,
    originLabel:
      originKind === "oem" ? "OEM" : originKind === "druhovyroba" ? "Druhovýroba" : "V podkladu neuvedeno",
    warehouseLabel,
    sellingPriceCzk: sellingPrice(draft.costPriceCzk),
    deliveryLeadTime,
  };

  return offer;
}

/** Allowlist polí. Cokoli navíc, včetně tajných sloupců, se do JSON nedostane. */
export function serializePublicOffer(offer: PublicOffer): string {
  const body: Record<string, unknown> = {};
  for (const key of PUBLIC_OFFER_KEYS) {
    body[key] = offer[key];
  }
  return JSON.stringify(body);
}
