import "server-only";

import { detectPublicBlock } from "@/lib/search/block";
import { BlockGate, readBlockThreshold, sourceFlagEnabled, type SourceLogger } from "@/lib/sources/block-gate";
import { normalizeOem } from "@/lib/sources/oem";
import type { PartSource, SourceCondition, SourceHealth, SourceOffer } from "@/lib/sources/types";

export const ALLEGRO_SOURCE_ID = "allegro";
export const ALLEGRO_TOKEN_URL = "https://allegro.pl/auth/oauth/token";
export const ALLEGRO_LISTING_URL = "https://api.allegro.pl/offers/listing";
export const ALLEGRO_ACCEPT = "application/vnd.allegro.public.v1+json";
export const ALLEGRO_USER_AGENT = "DamedilySearch/0.1 (+https://damedily.cz; allegro official api)";

const LISTING_LIMIT = "20";
const FILTER_ID = /^parameter\.[0-9]+$/;
const FILTER_VALUE = /^[A-Za-z0-9_]+$/;
const OFFER_ID = /^[A-Za-z0-9]+$/;

export type AllegroSourceOptions = {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  log?: SourceLogger;
  gate?: BlockGate;
};

type ConditionQuery = {
  id: string;
  value: string;
  condition: SourceCondition;
};

type HttpResult = {
  status: number;
  body: string;
  challenge: string | null;
  redirected: boolean;
  html: boolean;
};

function fold(value: string): string {
  return value.trim().toLocaleLowerCase("cs").normalize("NFD").replace(/\p{M}/gu, "");
}

/**
 * Stav z filtru `Stan`, který listing sám vrátí.
 * `używane` je used. `zamiennik`, `aftermarket` a `druhovýroba` jsou aftermarket.
 * `nowe` se nemapuje: oficiální výpis nerozliší originál a druhovýrobu.
 */
export function conditionFromStanValue(name: string): SourceCondition | null {
  const value = fold(name);
  if (value === "uzywane" || value === "used") return "used";
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

function basicAuth(id: string, secret: string): string {
  return Buffer.from(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`).toString("base64");
}

function listingUrl(oem: string, filter: ConditionQuery | null): string {
  const params = new URLSearchParams();
  params.set("phrase", oem);
  params.set("fallback", "false");
  params.set("limit", LISTING_LIMIT);
  params.set("searchMode", "REGULAR");
  if (filter) params.set(filter.id, filter.value);
  return `${ALLEGRO_LISTING_URL}?${params}`;
}

/**
 * Allegro přes oficiální REST. Bez klíčů nebo s `SOURCE_ALLEGRO=0` se vypne a síť nevolá.
 * HTTP 403 a captcha se počítají. Po prahu se zdroj vypne. HTML se jako nabídky nečte
 * a přesměrování se nesleduje.
 */
export function createAllegroSource(options: AllegroSourceOptions = {}): PartSource {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const log = options.log ?? ((message) => console.warn(`[sources] ${message}`));
  const gate = options.gate ?? new BlockGate(readBlockThreshold(env), log);
  let token: { value: string; exp: number } | null = null;

  function reason(): string | null {
    if (!sourceFlagEnabled(ALLEGRO_SOURCE_ID, env)) return "vypnuto přepínačem SOURCE_ALLEGRO";
    if (!allegroCredentials(env)) return "chybí ALLEGRO_CLIENT_ID nebo ALLEGRO_CLIENT_SECRET";
    if (gate.isTripped(ALLEGRO_SOURCE_ID)) return "vypnuto po odpovědích 403 nebo captcha";
    return null;
  }

  function noteBlock(result: HttpResult): boolean {
    if (result.redirected) return true;
    if (result.status === 403) {
      gate.record(ALLEGRO_SOURCE_ID, "http-403");
      return true;
    }
    const detected = detectPublicBlock(result.status, result.body, result.challenge);
    if (detected === "captcha" || detected === "cloudflare-challenge") {
      gate.record(ALLEGRO_SOURCE_ID, "captcha");
      return true;
    }
    if (result.html) return true;
    return false;
  }

  async function request(url: string, init: RequestInit): Promise<HttpResult | null> {
    const response = await fetchImpl(url, { ...init, redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      return { status: response.status, body: "", challenge: null, redirected: true, html: false };
    }
    const contentType = response.headers.get("content-type") ?? "";
    const body = await response.text();
    return {
      status: response.status,
      body,
      challenge: response.headers.get("cf-mitigated"),
      redirected: false,
      html: contentType.includes("text/html") || body.trimStart().startsWith("<"),
    };
  }

  async function accessToken(): Promise<string | null> {
    const credentials = allegroCredentials(env);
    if (!credentials) return null;
    const current = now().getTime();
    if (token && token.exp > current) return token.value;
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
    if (!result || noteBlock(result) || result.status !== 200) return null;
    try {
      const parsed = JSON.parse(result.body) as { access_token?: unknown; expires_in?: unknown };
      if (typeof parsed.access_token !== "string" || parsed.access_token.length === 0) return null;
      const expiresIn = typeof parsed.expires_in === "number" && parsed.expires_in > 0 ? parsed.expires_in : 3600;
      const skew = Math.min(60, expiresIn);
      token = { value: parsed.access_token, exp: current + (expiresIn - skew) * 1000 };
      return token.value;
    } catch {
      return null;
    }
  }

  async function loadListing(access: string, oem: string, filter: ConditionQuery | null): Promise<unknown | null> {
    const result = await request(listingUrl(oem, filter), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${access}`,
        Accept: ALLEGRO_ACCEPT,
        "User-Agent": ALLEGRO_USER_AGENT,
      },
    });
    if (!result || noteBlock(result) || result.status !== 200) return null;
    try {
      return JSON.parse(result.body) as unknown;
    } catch {
      return null;
    }
  }

  return {
    id: ALLEGRO_SOURCE_ID,
    async health(): Promise<SourceHealth> {
      const detail = reason();
      return detail ? { ok: false, detail } : { ok: true, detail: "klíče jsou nastavené" };
    },
    async searchByOem(oem: string): Promise<SourceOffer[]> {
      const normalized = normalizeOem(oem);
      if (!normalized || reason()) return [];
      const access = await accessToken();
      if (!access || reason()) return [];
      const first = await loadListing(access, normalized, null);
      if (!first || reason()) return [];
      const fetchedAt = now().toISOString();
      const offers: SourceOffer[] = [];
      const seen = new Set<string>();
      for (const query of allegroConditionQueries(first)) {
        if (reason()) break;
        const page = await loadListing(access, normalized, query);
        if (!page) continue;
        for (const offer of mapAllegroListing(page, { oem: normalized, condition: query.condition, fetchedAt })) {
          if (seen.has(offer.url)) continue;
          seen.add(offer.url);
          offers.push(offer);
        }
      }
      return offers;
    },
  };
}
