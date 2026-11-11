import { createListingTranslator } from "@/lib/search/prepare";
import { TtlCache } from "@/lib/search/cache";
import { readSearchConfig } from "@/lib/search/config";
import { createAutoPartnerConnector, createInterCarsConnector } from "@/lib/search/connectors/closed";
import { createInventoryConnector, createSupabaseStockLoader } from "@/lib/search/connectors/internal-stock";
import {
  createAutodocConnector,
  createBPartsConnector,
  createOvokoConnector,
} from "@/lib/search/connectors/public-pages";
import { ExchangeRateService } from "@/lib/search/currency";
import { getImageLinkStore } from "@/lib/search/images";
import { PoliteFetch } from "@/lib/search/polite-fetch";
import { createSupabaseSessionRecorder } from "@/lib/search/sessions";
import type { SearchDeps } from "@/lib/search/stream";
import { createXaiClient } from "@/lib/xai-grok";

export type SearchRuntime = Omit<SearchDeps, "userId">;

let runtime: SearchRuntime | null = null;

export function createSearchRuntime(env: Record<string, string | undefined> = process.env): SearchRuntime {
  const config = readSearchConfig(env);
  const cache = new TtlCache();
  const fetchPublic = new PoliteFetch({
    cache,
    cacheTtlMs: config.cacheTtlMs,
    minIntervalMs: config.minIntervalMs,
  });
  const rates = new ExchangeRateService();
  const client = env.XAI_API_KEY?.trim() ? createXaiClient({ env }) : null;
  const stockConfigured = Boolean(
    (env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL) && env.SUPABASE_SERVICE_ROLE_KEY,
  );

  return {
    connectors: [
      createInventoryConnector(config.enabled.internal_stock, createSupabaseStockLoader(env), stockConfigured),
      createOvokoConnector(config.enabled.ovoko, fetchPublic),
      createBPartsConnector(config.enabled.b_parts, fetchPublic),
      createAutodocConnector(config.enabled.autodoc, fetchPublic),
      createInterCarsConnector(config.enabled.inter_cars),
      createAutoPartnerConnector(config.enabled.auto_partner),
    ],
    rates: () => rates.table(),
    translate: createListingTranslator(client, cache),
    images: getImageLinkStore(),
    sessions: createSupabaseSessionRecorder(env),
    projectTag: config.projectTag,
    firstBudgetMs: config.firstBudgetMs,
    restBudgetMs: config.restBudgetMs,
    xai: client,
    log: (entry) => {
      console.warn(`[search] ${entry.source} ${entry.outcome}: ${entry.detail}`);
    },
  };
}

export function getSearchRuntime(): SearchRuntime {
  runtime ??= createSearchRuntime();
  return runtime;
}
