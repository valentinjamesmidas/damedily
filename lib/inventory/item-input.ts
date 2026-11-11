import { sellingPrice } from "@/lib/pricing";
import { TAG_REQUIRED_MESSAGE } from "@/lib/copy";

export const PLACEMENTS = ["action_offer", "permanent_offer", "van_tires"] as const;
export const PROJECT_TAG_VALUES = ["ekokladno", "damedily"] as const;
export const CONDITIONS = ["pouzity", "novy"] as const;
export const ORIGINS = ["oem", "druhovyroba"] as const;
export const SEASONS = ["letni", "zimni", "celorocni"] as const;
export const DIAMETERS = ["R15C", "R16C", "R17C"] as const;

export type Placement = (typeof PLACEMENTS)[number];
export type ProjectTagValue = (typeof PROJECT_TAG_VALUES)[number];
export type Season = (typeof SEASONS)[number];
export type TireDiameter = (typeof DIAMETERS)[number];

export type TireSpecsInput = {
  width: number;
  profile: number;
  diameter: TireDiameter;
  loadIndex: string;
  season: Season;
};

export type InventoryInput = {
  id: string | null;
  titleCs: string;
  oemNumber: string;
  partCategory: string;
  partCondition: (typeof CONDITIONS)[number];
  conditionDetail: string;
  originKind: (typeof ORIGINS)[number] | null;
  costPriceCzk: number;
  sellingPriceCzk: number;
  stockQuantity: number;
  placementType: Placement;
  internalProjectTag: ProjectTagValue;
  images: string[];
  vehicleText: string;
  tireSpecs: TireSpecsInput | null;
};

export type InventoryDraft = Omit<InventoryInput, "sellingPriceCzk" | "tireSpecs"> & {
  sellingPriceCzk: number | null;
  tireSpecs: TireSpecsInput | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

function money(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim().replace(",", ".")) : NaN;
  if (!Number.isFinite(number) || number < 0 || number > 10_000_000) return null;
  return Math.round(number * 100) / 100;
}

function whole(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(number) || number < 0 || number > 100_000) return null;
  return number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readTire(value: unknown): TireSpecsInput | null | "invalid" {
  if (value == null) return null;
  if (!isRecord(value)) return "invalid";
  const width = whole(value.width);
  const profile = whole(value.profile);
  const diameter = value.diameter;
  const loadIndex = text(value.loadIndex, 20);
  const season = value.season;
  if (!width || width < 100 || width > 400) return "invalid";
  if (!profile || profile < 20 || profile > 90) return "invalid";
  if (diameter !== "R15C" && diameter !== "R16C" && diameter !== "R17C") return "invalid";
  if (!loadIndex) return "invalid";
  if (season !== "letni" && season !== "zimni" && season !== "celorocni") return "invalid";
  return { width, profile, diameter, loadIndex, season };
}

export function validateInventoryInput(input: unknown): { ok: true; value: InventoryInput } | { ok: false; message: string } {
  if (!isRecord(input)) return { ok: false, message: "Formulář je neúplný." };
  if (input.internalProjectTag !== "ekokladno" && input.internalProjectTag !== "damedily") {
    return { ok: false, message: TAG_REQUIRED_MESSAGE };
  }

  const titleCs = text(input.titleCs, 160);
  const oemNumber = text(input.oemNumber, 40);
  const partCategory = text(input.partCategory, 80);
  const conditionDetail = text(input.conditionDetail, 400);
  const costPriceCzk = money(input.costPriceCzk);
  const stockQuantity = whole(input.stockQuantity);
  if (!titleCs) return { ok: false, message: "Vyplňte název." };
  if (!oemNumber) return { ok: false, message: "Vyplňte OEM." };
  if (!partCategory) return { ok: false, message: "Vyplňte kategorii." };
  if (input.partCondition !== "pouzity" && input.partCondition !== "novy") {
    return { ok: false, message: "Uveďte, jestli je díl použitý, nebo nový." };
  }
  if (!conditionDetail) return { ok: false, message: "Doplňte popis stavu." };
  if (costPriceCzk === null) return { ok: false, message: "Nákupní cena musí být nezáporné číslo." };
  if (stockQuantity === null) return { ok: false, message: "Počet musí být celé nezáporné číslo." };
  if (input.placementType !== "action_offer" && input.placementType !== "permanent_offer" && input.placementType !== "van_tires") {
    return { ok: false, message: "Vyberte umístění." };
  }
  if (input.originKind != null && input.originKind !== "oem" && input.originKind !== "druhovyroba") {
    return { ok: false, message: "Původ dílu je OEM, druhovýroba, nebo ho nechte prázdný." };
  }

  const id = input.id == null || input.id === "" ? null : text(input.id, 36);
  if (input.id != null && input.id !== "" && (id === null || !UUID.test(id))) {
    return { ok: false, message: "Položka k úpravě není platná." };
  }

  const images = Array.isArray(input.images) ? input.images.filter((image): image is string => typeof image === "string") : null;
  if (!images || images.length > 8 || images.some((image) => image.length === 0 || image.length > 500)) {
    return { ok: false, message: "Fotky se nepodařilo přečíst." };
  }

  const vehicleText = typeof input.vehicleText === "string" ? input.vehicleText.trim().slice(0, 300) : "";
  const tireSpecs = readTire(input.tireSpecs);
  if (tireSpecs === "invalid") return { ok: false, message: "Údaje pneu nesedí." };
  if (input.placementType === "van_tires" && !tireSpecs) {
    return { ok: false, message: "U pneu vyplňte šířku, profil, průměr, index a období." };
  }

  const explicitSelling = input.sellingPriceCzk == null || input.sellingPriceCzk === "" ? null : money(input.sellingPriceCzk);
  if (input.sellingPriceCzk != null && input.sellingPriceCzk !== "" && explicitSelling === null) {
    return { ok: false, message: "Prodejní cena musí být nezáporné číslo." };
  }

  return {
    ok: true,
    value: {
      id,
      titleCs,
      oemNumber,
      partCategory,
      partCondition: input.partCondition,
      conditionDetail,
      originKind: input.originKind ?? null,
      costPriceCzk,
      sellingPriceCzk: explicitSelling ?? sellingPrice(costPriceCzk),
      stockQuantity,
      placementType: input.placementType,
      internalProjectTag: input.internalProjectTag,
      images,
      vehicleText,
      tireSpecs: input.placementType === "van_tires" ? tireSpecs : null,
    },
  };
}
