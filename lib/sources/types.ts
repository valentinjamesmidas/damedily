/**
 * Kostra zdrojů podle OEM.
 *
 * `PartSource` hledá díl podle OEM a umí říct, jestli je zapnutý (`health`).
 * `SourceOffer` je společný tvar odpovědi. Cena v `price` je nákupní
 * (ceník zdroje). Do `PublicOffer` nepatří; prodejní cena vzniká až marží.
 *
 * Vrstva nečte HTML a neobchází captchu, přihlášení ani HTTP 403.
 * Do `/api/search/stream` není zapojená.
 *
 * Přepínače: `SOURCE_<ID>` (třeba `SOURCE_ALLEGRO`), `SOURCE_BLOCK_THRESHOLD`,
 * `OEM_CACHE_TTL_MS`, u Allegra `ALLEGRO_CLIENT_ID` a `ALLEGRO_CLIENT_SECRET`.
 * Bez klíčů se Allegro samo vypne a nespadne.
 */

/** used = použitý kus. aftermarket = druhovýroba. Jiný stav se sem neukládá. */
export type SourceCondition = "used" | "aftermarket";

/** Částka z ceníku zdroje. Pro DámeDíly je to nákup, ne cena pro zákazníka. */
export type SourcePrice = {
  amount: number;
  currency: string;
};

export type SourceOffer = {
  source: string;
  oem: string;
  name: string;
  condition: SourceCondition;
  price: SourcePrice;
  availability: string;
  url: string;
  /** ISO 8601, čas načtení z API. */
  fetchedAt: string;
};

export type SourceHealth = {
  ok: boolean;
  detail: string;
};

/** Úspěch. Prázdné `offers` znamená, že zdroj nic nenašel. */
export type SourceSearchSuccess = {
  ok: true;
  offers: SourceOffer[];
};

/** Chyba zdroje. Do cache se nezapisuje. `retryable` má fronta zkusit znovu. */
export type SourceSearchFailure = {
  ok: false;
  error: string;
  retryable: boolean;
  retryAfterSeconds?: number;
};

export type SourceSearchResult = SourceSearchSuccess | SourceSearchFailure;

export function sourceFailure(
  error: string,
  options: { retryable?: boolean; retryAfterSeconds?: number } = {},
): SourceSearchFailure {
  const failure: SourceSearchFailure = {
    ok: false,
    error,
    retryable: options.retryable ?? true,
  };
  if (options.retryAfterSeconds !== undefined) failure.retryAfterSeconds = options.retryAfterSeconds;
  return failure;
}

export interface PartSource {
  readonly id: string;
  searchByOem(oem: string): Promise<SourceSearchResult>;
  health(): Promise<SourceHealth>;
}

export function isSourceOffer(value: unknown): value is SourceOffer {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  const price = row.price;
  if (!price || typeof price !== "object") return false;
  const amount = (price as { amount?: unknown }).amount;
  const currency = (price as { currency?: unknown }).currency;
  return (
    typeof row.source === "string" &&
    row.source.length > 0 &&
    typeof row.oem === "string" &&
    row.oem.length > 0 &&
    typeof row.name === "string" &&
    row.name.trim().length > 0 &&
    (row.condition === "used" || row.condition === "aftermarket") &&
    typeof amount === "number" &&
    Number.isFinite(amount) &&
    amount >= 0 &&
    typeof currency === "string" &&
    /^[A-Z]{3}$/.test(currency) &&
    typeof row.availability === "string" &&
    row.availability.length > 0 &&
    typeof row.url === "string" &&
    row.url.startsWith("https://") &&
    typeof row.fetchedAt === "string" &&
    !Number.isNaN(Date.parse(row.fetchedAt))
  );
}
