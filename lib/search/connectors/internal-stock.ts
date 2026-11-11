import { compactOem, oemEqual } from "@/lib/search/oem";
import type { ConnectorResult, SupplierConnector, SupplierListing, SupplierSearchQuery } from "@/lib/search/types";
import type { ProjectTag } from "@/lib/white-label";

export type StockRow = {
  id: string;
  titleCs: string;
  oemNumber: string;
  partCategory: string;
  vehicleCompatibility: unknown;
  costPriceCzk: number;
  stockQuantity: number;
  images: string[];
  internalProjectTag: ProjectTag;
  partCondition: "pouzity" | "novy" | null;
  originKind: "oem" | "druhovyroba" | null;
  conditionDetail: string | null;
};

export function matchStock(rows: readonly StockRow[], query: SupplierSearchQuery): StockRow[] {
  return rows.filter((row) => {
    if (row.stockQuantity <= 0 || !row.partCondition) return false;
    if (query.oemNumber) return oemEqual(row.oemNumber, query.oemNumber);
    if (!query.category) return false;
    if (row.partCategory.trim().toLocaleLowerCase("cs-CZ") !== query.category.trim().toLocaleLowerCase("cs-CZ")) {
      return false;
    }
    if (!query.vehicle) return true;
    const vehicle = query.vehicle.trim().toLocaleLowerCase("cs-CZ");
    return JSON.stringify(row.vehicleCompatibility ?? "").toLocaleLowerCase("cs-CZ").includes(vehicle);
  });
}

export function stockToListing(row: StockRow): SupplierListing | null {
  if (!row.partCondition || row.stockQuantity <= 0) return null;
  if (!Number.isFinite(row.costPriceCzk) || row.costPriceCzk < 0) return null;
  return {
    sourcePlatform: "internal_stock",
    externalId: row.id,
    sourceUrl: "",
    title: row.titleCs,
    description: null,
    oemNumber: row.oemNumber,
    condition: row.partCondition,
    conditionDetail: row.conditionDetail,
    originKind: row.originKind,
    price: row.costPriceCzk,
    currency: "CZK",
    imageUrls: row.images,
    supplierLeadTime: null,
    category: row.partCategory,
    internalProjectTag: row.internalProjectTag,
  };
}

export function createInventoryConnector(
  enabled: boolean,
  load: (query: SupplierSearchQuery) => Promise<StockRow[]>,
  configured = true,
): SupplierConnector {
  return {
    source: "internal_stock",
    enabled,
    async search(query) {
      if (!enabled) return skipped("internal_stock", "vypnuto v konfiguraci");
      if (!configured) return skipped("internal_stock", "sklad není nakonfigurovaný");
      if (!query.oemNumber && !query.category) {
        return empty("internal_stock", "vlastní sklad se bez OEM nebo kategorie neprohledává");
      }
      try {
        const rows = matchStock(await load(query), query);
        const listings = rows.flatMap((row) => {
          const listing = stockToListing(row);
          return listing ? [listing] : [];
        });
        return {
          source: "internal_stock",
          listings,
          outcome: listings.length > 0 ? "ok" : "empty",
          detail: listings.length > 0 ? "vlastní sklad" : "ve skladu není vyhovující kus se známým stavem",
        };
      } catch {
        return { source: "internal_stock", listings: [], outcome: "error", detail: "sklad se nepodařilo načíst" };
      }
    },
  };
}

export function createSupabaseStockLoader(
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch = fetch,
): (query: SupplierSearchQuery) => Promise<StockRow[]> {
  return async (query) => {
    const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return [];

    const params = new URLSearchParams();
    params.set(
      "select",
      "id,title_cs,oem_number,part_category,vehicle_compatibility,cost_price_czk,stock_quantity,images,internal_project_tag,part_condition,origin_kind",
    );
    params.set("stock_quantity", "gt.0");
    params.set("part_condition", "not.is.null");

    const compact = compactOem(query.oemNumber);
    if (query.oemNumber) {
      if (!/^[A-Z0-9]{4,40}$/.test(compact)) return [];
      params.set("oem_compact", `eq.${compact}`);
    } else if (query.category && /^[\p{L}0-9 ./-]{2,80}$/u.test(query.category)) {
      params.set("part_category", `ilike.${query.category}`);
    } else {
      return [];
    }

    const response = await fetchImpl(`${url.replace(/\/$/, "")}/rest/v1/inventory_items?${params}`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) throw new Error(`sklad HTTP ${response.status}`);
    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) return [];
    return payload.flatMap((row) => {
      const parsed = parseStockRow(row);
      return parsed ? [parsed] : [];
    });
  };
}

function parseStockRow(value: unknown): StockRow | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const condition = row.part_condition === "pouzity" || row.part_condition === "novy" ? row.part_condition : null;
  const origin = row.origin_kind === "oem" || row.origin_kind === "druhovyroba" ? row.origin_kind : null;
  const tag = row.internal_project_tag === "ekokladno" || row.internal_project_tag === "damedily" ? row.internal_project_tag : null;
  const cost = typeof row.cost_price_czk === "number" ? row.cost_price_czk : Number(row.cost_price_czk);
  if (typeof row.id !== "string" || typeof row.title_cs !== "string" || typeof row.oem_number !== "string") return null;
  if (typeof row.part_category !== "string" || !tag || !Number.isFinite(cost)) return null;
  const stock = typeof row.stock_quantity === "number" ? row.stock_quantity : Number(row.stock_quantity);
  return {
    id: row.id,
    titleCs: row.title_cs,
    oemNumber: row.oem_number,
    partCategory: row.part_category,
    vehicleCompatibility: row.vehicle_compatibility ?? [],
    costPriceCzk: cost,
    stockQuantity: Number.isFinite(stock) ? stock : 0,
    images: Array.isArray(row.images) ? row.images.filter((image): image is string => typeof image === "string") : [],
    internalProjectTag: tag,
    partCondition: condition,
    originKind: origin,
    conditionDetail: null,
  };
}

function skipped(source: ConnectorResult["source"], detail: string): ConnectorResult {
  return { source, listings: [], outcome: "skipped", detail };
}

function empty(source: ConnectorResult["source"], detail: string): ConnectorResult {
  return { source, listings: [], outcome: "empty", detail };
}
