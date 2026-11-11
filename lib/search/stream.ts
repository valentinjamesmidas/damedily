import type { ListingNormalization } from "@/lib/ai-schemas";
import { SupplierAggregatorService } from "@/lib/search/aggregator";
import type { RateTable } from "@/lib/search/currency";
import { ImageLinkStore } from "@/lib/search/images";
import { prepareListings } from "@/lib/search/prepare";
import { isFullMatch, rankAlternativeIds, selectAlternatives, selectFirst, type PreparedOffer } from "@/lib/search/rank";
import type { SearchSessionRecorder } from "@/lib/search/sessions";
import type { ConnectorResult, SearchLog, SupplierConnector, SupplierListing, SupplierSearchQuery } from "@/lib/search/types";
import type { XaiClient } from "@/lib/xai-grok";
import { serializePublicOffer, type ProjectTag, type PublicOffer } from "@/lib/white-label";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  "X-Content-Type-Options": "nosniff",
};

export type SearchDeps = {
  connectors: readonly SupplierConnector[];
  rates: () => Promise<RateTable | null>;
  translate: (listing: SupplierListing) => Promise<ListingNormalization | null>;
  images: ImageLinkStore;
  sessions: SearchSessionRecorder;
  projectTag: ProjectTag;
  firstBudgetMs: number;
  restBudgetMs: number;
  rank?: (first: PreparedOffer, candidates: readonly PreparedOffer[]) => Promise<string[] | null>;
  sleep?: (ms: number) => Promise<void>;
  log?: (entry: SearchLog) => void;
  userId?: string | null;
  xai?: XaiClient | null;
};

function jsonError(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

function textOf(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) return null;
  return trimmed;
}

export function parseSearchRequest(payload: unknown): SupplierSearchQuery | Response {
  if (!payload || typeof payload !== "object") return jsonError(400, "Tělo požadavku musí být JSON.");
  const body = payload as Record<string, unknown>;
  const oemNumber = textOf(body.oemNumber, 40);
  const vehicle = textOf(body.vehicle, 120);
  const category = textOf(body.category, 80);
  const rawQuery = textOf(body.rawQuery, 500);
  if (body.oemNumber != null && body.oemNumber !== "" && !oemNumber) return jsonError(400, "OEM je neplatné.");
  if (body.vehicle != null && body.vehicle !== "" && !vehicle) return jsonError(400, "Vozidlo je neplatné.");
  if (body.category != null && body.category !== "" && !category) return jsonError(400, "Kategorie je neplatná.");
  if (body.rawQuery != null && body.rawQuery !== "" && !rawQuery) return jsonError(400, "Dotaz je neplatný.");
  if (!oemNumber && !vehicle && !category && !rawQuery) {
    return jsonError(400, "Chybí OEM, vozidlo, kategorie nebo dotaz.");
  }

  const queryType = body.queryType ?? "catalog";
  if (queryType !== "chat" && queryType !== "catalog" && queryType !== "photo") {
    return jsonError(400, "Typ dotazu musí být chat, catalog nebo photo.");
  }

  return { oemNumber, vehicle, category, rawQuery, queryType };
}

function publicOffer(offer: PublicOffer): PublicOffer {
  return JSON.parse(serializePublicOffer(offer)) as PublicOffer;
}

async function waitFor(tasks: Promise<unknown>[], budgetMs: number, sleep: (ms: number) => Promise<void>): Promise<void> {
  await Promise.race([Promise.all(tasks), sleep(Math.max(0, budgetMs))]);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function handleSearchPost(request: Request, deps: SearchDeps): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonError(400, "Tělo požadavku musí být JSON.");
  }
  const parsed = parseSearchRequest(payload);
  if (parsed instanceof Response) return parsed;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      try {
        await runSearch(parsed, deps, send);
      } catch {
        send({ type: "error", message: "Hledání se nepodařilo dokončit." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { status: 200, headers: SSE_HEADERS });
}

async function runSearch(
  query: SupplierSearchQuery,
  deps: SearchDeps,
  send: (event: unknown) => void,
): Promise<void> {
  const sleep = deps.sleep ?? defaultSleep;
  const log = deps.log ?? (() => undefined);
  const aggregator = new SupplierAggregatorService(deps.connectors);
  for (const connector of aggregator.disabled()) {
    log({ source: connector.source, outcome: "skipped", detail: "vypnuto v konfiguraci" });
  }

  const settled: ConnectorResult[] = [];
  const tasks = aggregator.start(query).map(async (task) => {
    const result = await task;
    settled.push(result);
    log({ source: result.source, outcome: result.outcome, detail: result.detail });
    return result;
  });

  const started = Date.now();
  await waitFor(tasks, deps.firstBudgetMs, sleep);
  const rates = await deps.rates();
  if (!rates) log({ source: "rates", outcome: "empty", detail: "kurz teď není k dispozici, cizí měna se vynechá" });

  const draft = {
    userId: deps.userId ?? null,
    queryType: query.queryType,
    rawQuery: query.rawQuery || [query.oemNumber, query.vehicle, query.category].filter(Boolean).join(" "),
    resolvedOem: query.oemNumber,
  };
  const remember = async (status: "first_found" | "searching_alternatives" | "completed", offers: PublicOffer[]) => {
    try {
      await deps.sessions.save(draft, { status, results: offers });
    } catch {
      log({ source: "session", outcome: "error", detail: "hledání se nepodařilo zapsat" });
    }
  };

  const prepare = (listings: SupplierListing[]) =>
    prepareListings({
      listings,
      rates,
      translate: deps.translate,
      images: deps.images,
      projectTag: deps.projectTag,
    });

  let first = selectFirst(await prepare(settled.flatMap((result) => result.listings)), query);
  const shown: PublicOffer[] = [];
  if (first) {
    const offer = publicOffer(first.offer);
    shown.push(offer);
    send({ type: "status", status: "first_found" });
    send({ type: "offer", phase: "first", offer });
    await remember("first_found", shown);
  }

  const remaining = Math.max(0, deps.restBudgetMs - (Date.now() - started));
  await waitFor(tasks, remaining, sleep);
  const all = await prepare(settled.flatMap((result) => result.listings));
  if (!first) first = selectFirst(all, query);
  if (first && shown.length === 0) {
    const offer = publicOffer(first.offer);
    shown.push(offer);
    send({ type: "status", status: "first_found" });
    send({ type: "offer", phase: "first", offer });
    await remember("first_found", shown);
  }

  if (!first) {
    send({ type: "status", status: "completed" });
    await remember("completed", []);
    return;
  }

  send({ type: "status", status: "searching_alternatives" });
  await remember("searching_alternatives", shown);

  const rank =
    deps.rank ??
    (deps.xai
      ? (item: PreparedOffer, candidates: readonly PreparedOffer[]) => rankAlternativeIds(deps.xai as XaiClient, item, candidates)
      : async () => null);
  let preferred: string[] | null = [];
  if (all.filter((item) => isFullMatch(query, item)).length > 1) {
    try {
      preferred = await rank(first, all);
    } catch {
      preferred = null;
      log({ source: "rank", outcome: "error", detail: "řazení modelem selhalo, platí pravidla" });
    }
    if (preferred === null) log({ source: "rank", outcome: "fallback", detail: "alternativy vybrala pravidla" });
  }

  for (const alternative of selectAlternatives(all, query, first, preferred)) {
    const offer = publicOffer(alternative.offer);
    shown.push(offer);
    send({ type: "offer", phase: "alternative", offer });
  }

  send({ type: "status", status: "completed" });
  await remember("completed", shown);
}
