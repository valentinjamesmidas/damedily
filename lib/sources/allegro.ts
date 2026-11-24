import "server-only";

import { detectPublicBlock } from "@/lib/search/block";
import { BlockGate, readBlockThreshold, readBlockWindowMs, sourceFlagEnabled, type SourceLogger } from "@/lib/sources/block-gate";
import { normalizeOem, oemLookupPhrases } from "@/lib/sources/oem";
import { sourceFailure, type PartSource, type SourceCondition, type SourceHealth, type SourceOffer, type SourceSearchResult } from "@/lib/sources/types";

export const ALLEGRO_SOURCE_ID = "allegro";
export const ALLEGRO_TOKEN_URL = "https://allegro.pl/auth/oauth/token";
export const ALLEGRO_LISTING_URL = "https://api.allegro.pl/offers/listing";
export const ALLEGRO_ACCEPT = "application/vnd.allegro.public.v1+json";
export const ALLEGRO_USER_AGENT = "DamedilySearch/0.1 (+https://damedily.cz; allegro official api)";
export const ALLEGRO_BODY_LIMIT_BYTES = 512_000;
export const ALLEGRO_TIMEOUT_MS = 8_000;

const LISTING_LIMIT = "20";
const FILTER_ID = /^parameter\.[0-9]+$/;
const FILTER_VALUE = /^[A-Za-z0-9_]+$/;
const OFFER_ID = /^[A-Za-z0-9]+$/;

export type AllegroSourceOptions = {
  env?: Record<string, string | undefined>;
  /** Bez této funkce se ostré API nevolá. Testy sem dají mock. */
  fetchImpl?: typeof fetch;
  now?: () => Date;
  log?: SourceLogger;
  gate?: BlockGate;
  timeoutMs?: number;
  bodyLimitBytes?: number;
};

type ConditionQuery = {
  id: string;
  value: string;
  condition: SourceCondition;
};

type HttpHit = {
  ok: true;
  status: number;
  body: string;
  headers: Headers;
  redirected: boolean;
  html: boolean;
};

type HttpMiss = {
  ok: false;
  error: string;
  retryable: boolean;
  retryAfterSeconds?: number;
  status?: number;
};

function fold(value: string): string {
  return value.trim().toLocaleLowerCase("cs").normalize("NFD").replace(/\p{M}/gu, "");
}

/**
 * Stav z filtru `Stan`, který listing sám vrátí.
 * `używane` i `Używany` jsou used. `zamiennik`, `aftermarket` a `druhovýroba` jsou aftermarket.
 * `nowe` se nemapuje: oficiální výpis nerozliší originál a druhovýrobu.
 */
export function conditionFromStanValue(name: string): SourceCondition | null {
  const value = fold(name);
  if (value === "uzywane" || value === "uzywany" || value === "used") return "used";
  if (value === "aftermarket" || value === "zamiennik" || value === "druhovyroba") return "aftermarket";
  return null;
}

export function allegroCredentials(
  env: Record<string, string | undefined>,
): { id: string; secret: string } | null {
  const id = env.ALLEGRO_CLIENT_ID?.trim() ?? "";
  const secret = env.ALLEGRO_CLIENT_SECRET?.trim() ?? "";
  if (!id || !secret) return null;
  return { id, secret };
}

export function allegroConditionQueries(body: unknown): ConditionQuery[] {
  if (!body || typeof body !== "object") return [];
  const filters = (body as { filters?: unknown }).filters;
  if (!Array.isArray(filters)) return [];
  const queries: ConditionQuery[] = [];
  const seen = new Set<string>();
  for (const filter of filters) {
    if (!filter || typeof filter !== "object") continue;
    const record = filter as { id?: unknown; name?: unknown; values?: unknown };
    if (typeof record.id !== "string" || !FILTER_ID.test(record.id)) continue;
    if (typeof record.name !== "string" || fold(record.name) !== "stan") continue;
    if (!Array.isArray(record.values)) continue;
    for (const entry of record.values) {
      if (!entry || typeof entry !== "object") continue;
      const value = (entry as { value?: unknown; name?: unknown }).value;
      const name = (entry as { name?: unknown }).name;
      if (typeof value !== "string" || !FILTER_VALUE.test(value)) continue;
      if (typeof name !== "string") continue;
      const condition = conditionFromStanValue(name);
      if (!condition) continue;
      const key = `${record.id}=${value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      queries.push({ id: record.id, value, condition });
    }
  }
  return queries;
}

function moneyAmount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+(\.\d+)?$/.test(value)) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

function listingItems(body: unknown): unknown[] {
  if (!body || typeof body !== "object") return [];
  const items = (body as { items?: unknown }).items;
  if (!items || typeof items !== "object") return [];
  const promoted = (items as { promoted?: unknown }).promoted;
  const regular = (items as { regular?: unknown }).regular;
  return [...(Array.isArray(promoted) ? promoted : []), ...(Array.isArray(regular) ? regular : [])];
}

/**
 * Nabídky z těla `GET /offers/listing`. Cena je `sellingMode.price`, ne doprava.
 * Stav bere volající z filtru, kterým výpis zúžil; v samotné nabídce Allegro stav neposílá.
 * Aukce a neúplné řádky se vynechají.
 */
export function mapAllegroListing(
  body: unknown,
  input: { oem: string; condition: SourceCondition; fetchedAt: string },
): SourceOffer[] {
  const offers: SourceOffer[] = [];
  const seen = new Set<string>();
  for (const item of listingItems(body)) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.id !== "string" || !OFFER_ID.test(record.id) || seen.has(record.id)) continue;
    if (typeof record.name !== "string" || record.name.trim().length === 0 || record.name.trim().length > 500) {
      continue;
    }
    const sellingMode = record.sellingMode;
    if (!sellingMode || typeof sellingMode !== "object") continue;
    const mode = sellingMode as { format?: unknown; price?: unknown };
    if (mode.format !== "BUY_NOW") continue;
    const price = mode.price;
    if (!price || typeof price !== "object") continue;
    const amount = moneyAmount((price as { amount?: unknown }).amount);
    const currency = (price as { currency?: unknown }).currency;
    if (amount === null || typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) continue;
    const stock = record.stock;
    if (!stock || typeof stock !== "object") continue;
    const available = (stock as { available?: unknown }).available;
    if (typeof available !== "number" || !Number.isInteger(available) || available < 0) continue;

    seen.add(record.id);
    offers.push({
      source: ALLEGRO_SOURCE_ID,
      oem: input.oem,
      name: record.name.trim(),
      condition: input.condition,
      price: { amount, currency },
      availability: String(available),
      url: `https://allegro.pl/oferta/${record.id}`,
      fetchedAt: input.fetchedAt,
    });
  }
  return offers;
}

export function retryAfterSeconds(header: string | null, nowMs: number): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, Math.ceil((date - nowMs) / 1000));
}

async function readBodyLimited(response: Response, maxBytes: number): Promise<string | null> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    return text.length > maxBytes ? null : text;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const step = await reader.read();
    if (step.done) break;
    total += step.value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(step.value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

function basicAuth(id: string, secret: string): string {
  return Buffer.from(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`).toString("base64");
}

function listingUrl(phrase: string, filter: ConditionQuery | null): string {
  const params = new URLSearchParams();
  params.set("phrase", phrase);
  params.set("fallback", "false");
  params.set("limit", LISTING_LIMIT);
  params.set("searchMode", "REGULAR");
  if (filter) params.set(filter.id, filter.value);
  return `${ALLEGRO_LISTING_URL}?${params}`;
}

function referenceSource(): PartSource {
  return {
    id: ALLEGRO_SOURCE_ID,
    async health() {
      return {
        ok: false,
        detail: "referenční implementace nad fixturami, ostré API se nevolá",
      };
    },
    async searchByOem(): Promise<SourceSearchResult> {
      return { ok: true, offers: [] };
    },
  };
}

/**
 * Referenční klient Allegra. `GET /offers/listing` novým aplikacím vrací 403,
 * proto se bez předaného `fetchImpl` ostré API nevolá. Testy pouštějí fixtury.
 * HTTP 403 a captcha se počítají. Po prahu se zdroj vypne. HTML se jako nabídky nečte
 * a přesměrování se nesleduje. Chyba není prázdný seznam nabídek.
 */
export function createAllegroSource(options: AllegroSourceOptions = {}): PartSource {
  if (!options.fetchImpl) return referenceSource();

  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl;
  const now = options.now ?? (() => new Date());
  const log = options.log ?? ((message) => console.warn(`[sources] ${message}`));
  const gate =
    options.gate ??
    new BlockGate(readBlockThreshold(env), log, readBlockWindowMs(env), now);
  const timeoutMs = options.timeoutMs ?? ALLEGRO_TIMEOUT_MS;
  const bodyLimitBytes = options.bodyLimitBytes ?? ALLEGRO_BODY_LIMIT_BYTES;
  let token: { value: string; exp: number } | null = null;
  let tokenFlight: Promise<string | HttpMiss> | null = null;

  function reason(): string | null {
    if (!sourceFlagEnabled(ALLEGRO_SOURCE_ID, env)) return "vypnuto přepínačem SOURCE_ALLEGRO";
    if (!allegroCredentials(env)) return "chybí ALLEGRO_CLIENT_ID nebo ALLEGRO_CLIENT_SECRET";
    if (gate.isTripped(ALLEGRO_SOURCE_ID)) return "vypnuto po odpovědích 403 nebo captcha";
    return null;
  }

  function isHttpMiss(value: unknown): value is HttpMiss {
    return Boolean(value && typeof value === "object" && "ok" in value && value.ok === false && "error" in value);
  }

  function asFailure(miss: HttpMiss): SourceSearchResult {
    return sourceFailure(miss.error, { retryable: miss.retryable, retryAfterSeconds: miss.retryAfterSeconds });
  }

  function blocked(hit: HttpHit): HttpMiss | null {
    if (hit.redirected) {
      return { ok: false, error: "přesměrování, nepokračujeme", retryable: true, status: hit.status };
    }
    if (hit.status === 403) {
      gate.record(ALLEGRO_SOURCE_ID, "http-403");
      return { ok: false, error: "http-403", retryable: true, status: 403 };
    }
    if (hit.status === 429) {
      return {
        ok: false,
        error: "http-429",
        retryable: true,
        status: 429,
        retryAfterSeconds: retryAfterSeconds(hit.headers.get("retry-after"), now().getTime()),
      };
    }
    if (hit.status === 401) {
      return { ok: false, error: "http-401", retryable: true, status: 401 };
    }
    const detected = detectPublicBlock(hit.status, hit.body, hit.headers.get("cf-mitigated"));
    if (detected === "captcha" || detected === "cloudflare-challenge") {
      gate.record(ALLEGRO_SOURCE_ID, "captcha");
      return { ok: false, error: detected, retryable: true, status: hit.status };
    }
    if (hit.html) return { ok: false, error: "odpověď není JSON", retryable: true, status: hit.status };
    if (hit.status >= 500 || hit.status === 408) {
      return { ok: false, error: `http-${hit.status}`, retryable: true, status: hit.status };
    }
    if (hit.status !== 200) {
      return { ok: false, error: `http-${hit.status}`, retryable: true, status: hit.status };
    }
    return null;
  }

  async function request(url: string, init: RequestInit): Promise<HttpHit | HttpMiss> {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        ...init,
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      if (name === "TimeoutError" || name === "AbortError") {
        return { ok: false, error: "timeout", retryable: true };
      }
      return { ok: false, error: "síť zdroje selhala", retryable: true };
    }
    if (response.status >= 300 && response.status < 400) {
      return {
        ok: true,
        status: response.status,
        body: "",
        headers: response.headers,
        redirected: true,
        html: false,
      };
    }
    const body = await readBodyLimited(response, bodyLimitBytes);
    if (body === null) return { ok: false, error: "odpověď je větší než limit", retryable: true, status: response.status };
    const contentType = response.headers.get("content-type") ?? "";
    return {
      ok: true,
      status: response.status,
      body,
      headers: response.headers,
      redirected: false,
      html: contentType.includes("text/html") || body.trimStart().startsWith("<"),
    };
  }

  async function requestToken(): Promise<string | HttpMiss> {
    const credentials = allegroCredentials(env);
    if (!credentials) return { ok: false, error: "chybí klíče", retryable: false };
    const result = await request(ALLEGRO_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth(credentials.id, credentials.secret)}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": ALLEGRO_USER_AGENT,
      },
      body: "grant_type=client_credentials",
    });
    if (!result.ok) return result;
    const problem = blocked(result);
    if (problem) return problem;
    try {
      const parsed = JSON.parse(result.body) as { access_token?: unknown; expires_in?: unknown };
      if (typeof parsed.access_token !== "string" || parsed.access_token.length === 0) {
        return { ok: false, error: "token chybí", retryable: true };
      }
      const expiresIn = typeof parsed.expires_in === "number" && parsed.expires_in > 0 ? parsed.expires_in : 3600;
      const skew = Math.min(60, expiresIn);
      token = { value: parsed.access_token, exp: now().getTime() + (expiresIn - skew) * 1000 };
      return token.value;
    } catch {
      return { ok: false, error: "rozbitý JSON tokenu", retryable: true };
    }
  }

  function accessToken(force = false): Promise<string | HttpMiss> {
    const current = now().getTime();
    if (!force && token && token.exp > current) return Promise.resolve(token.value);
    if (!force && tokenFlight) return tokenFlight;
    const flight = requestToken().finally(() => {
      if (tokenFlight === flight) tokenFlight = null;
    });
    tokenFlight = flight;
    return flight;
  }

  async function loadListing(phrase: string, filter: ConditionQuery | null, refreshed = false): Promise<unknown | HttpMiss> {
    const access = await accessToken(refreshed);
    if (typeof access !== "string") return access;
    const result = await request(listingUrl(phrase, filter), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${access}`,
        Accept: ALLEGRO_ACCEPT,
        "User-Agent": ALLEGRO_USER_AGENT,
      },
    });
    if (!result.ok) return result;
    if (result.status === 401 && !refreshed) {
      token = null;
      return loadListing(phrase, filter, true);
    }
    const problem = blocked(result);
    if (problem) return problem;
    try {
      return JSON.parse(result.body) as unknown;
    } catch {
      return { ok: false, error: "rozbitý JSON výpisu", retryable: true, status: result.status };
    }
  }

  return {
    id: ALLEGRO_SOURCE_ID,
    async health(): Promise<SourceHealth> {
      const detail = reason();
      return detail ? { ok: false, detail } : { ok: true, detail: "klíče jsou nastavené" };
    },
    async searchByOem(oem: string): Promise<SourceSearchResult> {
      const phrases = oemLookupPhrases(oem);
      const compact = normalizeOem(oem);
      if (!compact || reason()) return { ok: true, offers: [] };
      const fetchedAt = now().toISOString();
      const offers: SourceOffer[] = [];
      const seen = new Set<string>();
      for (const phrase of phrases) {
        const first = await loadListing(phrase, null);
        if (isHttpMiss(first)) return asFailure(first);
        if (!first) return sourceFailure("výpis se nepodařilo načíst");
        if (reason()) return sourceFailure("vypnuto po blokaci", { retryable: false });
        for (const query of allegroConditionQueries(first)) {
          if (reason()) break;
          const page = await loadListing(phrase, query);
          if (isHttpMiss(page)) return asFailure(page);
          if (!page) continue;
          for (const offer of mapAllegroListing(page, { oem: compact, condition: query.condition, fetchedAt })) {
            if (seen.has(offer.url)) continue;
            seen.add(offer.url);
            offers.push(offer);
          }
        }
      }
      return { ok: true, offers };
    },
  };
}
