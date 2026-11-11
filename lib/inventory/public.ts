import { publicSupabaseEnv } from "@/lib/supabase/env";

export type PublicStockItem = {
  id: string;
  titleCs: string;
  oemNumber: string;
  partCategory: string;
  vehicleCompatibility: unknown;
  tireSpecs: {
    width: number;
    profile: number;
    diameter: string;
    loadIndex: string;
    season: string;
  } | null;
  sellingPriceCzk: number;
  stockQuantity: number;
  placementType: "action_offer" | "permanent_offer" | "van_tires";
  images: string[];
  partCondition: "pouzity" | "novy" | null;
  originKind: "oem" | "druhovyroba" | null;
  conditionDetail: string | null;
};

const PLACEMENTS = new Set(["action_offer", "permanent_offer", "van_tires"]);

function money(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(number) || number < 0) return null;
  return number;
}

function tireOf(value: unknown): PublicStockItem["tireSpecs"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const width = typeof row.width === "number" ? row.width : Number(row.width);
  const profile = typeof row.profile === "number" ? row.profile : Number(row.profile);
  if (!Number.isFinite(width) || !Number.isFinite(profile)) return null;
  if (typeof row.diameter !== "string" || typeof row.load_index !== "string" || typeof row.season !== "string") return null;
  return { width, profile, diameter: row.diameter, loadIndex: row.load_index, season: row.season };
}

/** Složí veřejnou kartu jen z povolených polí. Nákupní cena a tag, i když v JSON jsou, zmizí. */
export function parsePublicStock(payload: unknown): PublicStockItem[] {
  if (!Array.isArray(payload)) return [];
  const items: PublicStockItem[] = [];
  for (const value of payload) {
    if (!value || typeof value !== "object") continue;
    const row = value as Record<string, unknown>;
    const selling = money(row.selling_price_czk);
    const stock = money(row.stock_quantity);
    const placement = row.placement_type;
    if (typeof row.id !== "string" || typeof row.title_cs !== "string" || typeof row.oem_number !== "string") continue;
    if (typeof row.part_category !== "string" || selling === null || stock === null || typeof placement !== "string") continue;
    if (!PLACEMENTS.has(placement)) continue;
    const condition = row.part_condition === "pouzity" || row.part_condition === "novy" ? row.part_condition : null;
    const origin = row.origin_kind === "oem" || row.origin_kind === "druhovyroba" ? row.origin_kind : null;
    items.push({
      id: row.id,
      titleCs: row.title_cs,
      oemNumber: row.oem_number,
      partCategory: row.part_category,
      vehicleCompatibility: row.vehicle_compatibility ?? [],
      tireSpecs: tireOf(row.tire_specs),
      sellingPriceCzk: selling,
      stockQuantity: stock,
      placementType: placement as PublicStockItem["placementType"],
      images: Array.isArray(row.images) ? row.images.filter((image): image is string => typeof image === "string") : [],
      partCondition: condition,
      originKind: origin,
      conditionDetail: typeof row.condition_detail === "string" && row.condition_detail.trim() ? row.condition_detail.trim() : null,
    });
  }
  return items;
}

export function isOwnInventoryImage(url: string, supabaseUrl: string | null): boolean {
  if (url.startsWith("/") && !url.startsWith("//") && !url.includes("://")) return true;
  if (!supabaseUrl) return false;
  try {
    const image = new URL(url);
    const base = new URL(supabaseUrl);
    return image.origin === base.origin && image.pathname.startsWith("/storage/v1/object/public/inventory-images/");
  } catch {
    return false;
  }
}

export function displayableImages(images: readonly string[], supabaseUrl: string | null): string[] {
  return images.filter((image) => isOwnInventoryImage(image, supabaseUrl));
}

const PUBLIC_COLUMNS = [
  "id",
  "title_cs",
  "oem_number",
  "part_category",
  "vehicle_compatibility",
  "tire_specs",
  "selling_price_czk",
  "stock_quantity",
  "placement_type",
  "images",
  "created_at",
  "part_condition",
  "origin_kind",
  "condition_detail",
].join(",");

export async function loadPublicInventory(fetchImpl: typeof fetch = fetch): Promise<PublicStockItem[]> {
  const env = publicSupabaseEnv();
  if (!env) return [];
  try {
    const params = new URLSearchParams({
      select: PUBLIC_COLUMNS,
      stock_quantity: "gt.0",
      order: "created_at.desc",
    });
    const response = await fetchImpl(`${env.url}/rest/v1/public_inventory?${params}`, {
      headers: {
        apikey: env.anonKey,
        Authorization: `Bearer ${env.anonKey}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    if (!response.ok) return [];
    return parsePublicStock(await response.json()).map((item) => ({
      ...item,
      images: displayableImages(item.images, env.url),
    }));
  } catch {
    return [];
  }
}
