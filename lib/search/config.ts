import { SOURCE_PLATFORMS, type ProjectTag, type SourcePlatform } from "@/lib/white-label";

export type SearchConfig = {
  enabled: Record<SourcePlatform, boolean>;
  projectTag: ProjectTag;
  firstBudgetMs: number;
  restBudgetMs: number;
  cacheTtlMs: number;
  minIntervalMs: number;
};

const FLAGS: Record<SourcePlatform, string> = {
  internal_stock: "SUPPLIER_INTERNAL_STOCK",
  inter_cars: "SUPPLIER_INTER_CARS",
  auto_partner: "SUPPLIER_AUTO_PARTNER",
  autodoc: "SUPPLIER_AUTODOC",
  ovoko: "SUPPLIER_OVOKO",
  b_parts: "SUPPLIER_B_PARTS",
};

function flag(env: Record<string, string | undefined>, name: string): boolean {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return true;
  return raw === "1" || raw.toLowerCase() === "true" || raw.toLowerCase() === "yes";
}

function positive(env: Record<string, string | undefined>, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${name} musí být nezáporné číslo.`);
  }
  return value;
}

export function readSearchConfig(env: Record<string, string | undefined> = process.env): SearchConfig {
  const tag = env.SEARCH_PROJECT_TAG?.trim() || "damedily";
  if (tag !== "damedily" && tag !== "ekokladno") {
    throw new TypeError("SEARCH_PROJECT_TAG musí být damedily nebo ekokladno.");
  }

  const enabled = Object.fromEntries(
    SOURCE_PLATFORMS.map((source) => [source, flag(env, FLAGS[source])]),
  ) as Record<SourcePlatform, boolean>;

  return {
    enabled,
    projectTag: tag,
    firstBudgetMs: positive(env, "SEARCH_FIRST_BUDGET_MS", 1_500),
    restBudgetMs: positive(env, "SEARCH_REST_BUDGET_MS", 8_000),
    cacheTtlMs: positive(env, "SEARCH_CACHE_TTL_MS", 6 * 60 * 60 * 1000),
    minIntervalMs: positive(env, "SEARCH_MIN_INTERVAL_MS", 8_000),
  };
}
