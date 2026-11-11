import type { Placement, ProjectTagValue, TireSpecsInput } from "@/lib/inventory/item-input";

export type AdminItem = {
  id: string;
  titleCs: string;
  oemNumber: string;
  partCategory: string;
  partCondition: "pouzity" | "novy" | null;
  conditionDetail: string;
  originKind: "oem" | "druhovyroba" | null;
  costPriceCzk: number;
  sellingPriceCzk: number;
  stockQuantity: number;
  placementType: Placement;
  internalProjectTag: ProjectTagValue;
  images: string[];
  vehicleText: string;
  tireSpecs: TireSpecsInput | null;
};

function money(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(number)) return null;
  return number;
}

function vehicleText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const row = item as Record<string, unknown>;
      if (typeof row.text === "string") return row.text;
      return [row.brand, row.model, row.years].filter((part): part is string => typeof part === "string").join(" ");
    })
    .filter(Boolean)
    .join(", ");
}

function tireSpecs(value: unknown): TireSpecsInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const width = money(row.width);
  const profile = money(row.profile);
  if (width === null || profile === null) return null;
  if (row.diameter !== "R15C" && row.diameter !== "R16C" && row.diameter !== "R17C") return null;
  if (row.season !== "letni" && row.season !== "zimni" && row.season !== "celorocni") return null;
  if (typeof row.load_index !== "string") return null;
  return {
    width,
    profile,
    diameter: row.diameter,
    loadIndex: row.load_index,
    season: row.season,
  };
}

export function parseAdminItems(payload: unknown): AdminItem[] {
  if (!Array.isArray(payload)) return [];
  const items: AdminItem[] = [];
  for (const value of payload) {
    if (!value || typeof value !== "object") continue;
    const row = value as Record<string, unknown>;
    const cost = money(row.cost_price_czk);
    const selling = money(row.selling_price_czk);
    const stock = money(row.stock_quantity);
    const placement = row.placement_type;
    const tag = row.internal_project_tag;
    if (typeof row.id !== "string" || typeof row.title_cs !== "string" || typeof row.oem_number !== "string") continue;
    if (typeof row.part_category !== "string" || cost === null || selling === null || stock === null) continue;
    if (placement !== "action_offer" && placement !== "permanent_offer" && placement !== "van_tires") continue;
    if (tag !== "ekokladno" && tag !== "damedily") continue;
    const condition = row.part_condition === "pouzity" || row.part_condition === "novy" ? row.part_condition : null;
    const origin = row.origin_kind === "oem" || row.origin_kind === "druhovyroba" ? row.origin_kind : null;
    items.push({
      id: row.id,
      titleCs: row.title_cs,
      oemNumber: row.oem_number,
      partCategory: row.part_category,
      partCondition: condition,
      conditionDetail: typeof row.condition_detail === "string" ? row.condition_detail : "",
      originKind: origin,
      costPriceCzk: cost,
      sellingPriceCzk: selling,
      stockQuantity: stock,
      placementType: placement,
      internalProjectTag: tag,
      images: Array.isArray(row.images) ? row.images.filter((image): image is string => typeof image === "string") : [],
      vehicleText: vehicleText(row.vehicle_compatibility),
      tireSpecs: tireSpecs(row.tire_specs),
    });
  }
  return items;
}
