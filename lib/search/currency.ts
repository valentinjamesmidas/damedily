export const CNB_DAILY_URL = "https://api.cnb.cz/cnbapi/exrates/daily?lang=EN";
export const ECB_DAILY_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

export type RateTable = {
  source: "cnb" | "ecb";
  validFor: string;
  /** Kolik Kč stojí jedna jednotka měny. */
  czkPerUnit: Record<string, number>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Denní kurz ČNB. `rate` je cena `amount` jednotek v Kč. */
export function parseCnbDaily(payload: unknown): RateTable {
  if (!isRecord(payload) || !Array.isArray(payload.rates)) {
    throw new TypeError("Denní kurz ČNB nemá pole rates.");
  }

  const czkPerUnit: Record<string, number> = { CZK: 1 };
  let validFor: string | null = null;
  for (const row of payload.rates) {
    if (!isRecord(row)) continue;
    const code = typeof row.currencyCode === "string" ? row.currencyCode : "";
    const amount = typeof row.amount === "number" ? row.amount : Number.NaN;
    const rate = typeof row.rate === "number" ? row.rate : Number.NaN;
    const day = typeof row.validFor === "string" ? row.validFor : null;
    if (!/^[A-Z]{3}$/.test(code) || !(amount > 0) || !(rate > 0)) continue;
    czkPerUnit[code] = rate / amount;
    validFor ??= day;
  }

  if (!validFor || czkPerUnit.EUR === undefined) {
    throw new TypeError("Denní kurz ČNB je neúplný.");
  }
  return { source: "cnb", validFor, czkPerUnit };
}

/**
 * Denní referenční kurz ECB. Hodnoty jsou jednotky měny za 1 EUR.
 * Převod do Kč jde přes kurz CZK v tom samém souboru.
 */
export function parseEcbDaily(xml: string): RateTable {
  const time = /<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]/.exec(xml);
  const validFor = time?.[1];
  if (!validFor) throw new TypeError("Kurz ECB nemá datum.");

  const perEur: Record<string, number> = {};
  const pattern = /<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9.]+)['"]\s*\/>/g;
  for (const match of xml.matchAll(pattern)) {
    const code = match[1];
    const rate = Number(match[2]);
    if (code && Number.isFinite(rate) && rate > 0) perEur[code] = rate;
  }

  const czkPerEur = perEur.CZK;
  if (!czkPerEur) throw new TypeError("Kurz ECB nemá CZK.");

  const czkPerUnit: Record<string, number> = { CZK: 1, EUR: czkPerEur };
  for (const [code, perEuro] of Object.entries(perEur)) {
    if (code === "CZK") continue;
    czkPerUnit[code] = czkPerEur / perEuro;
  }
  return { source: "ecb", validFor, czkPerUnit };
}

export function convertToCzk(amount: number, currency: string, table: RateTable): number | null {
  if (!Number.isFinite(amount) || amount < 0) return null;
  const code = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return null;
  const perUnit = table.czkPerUnit[code];
  if (perUnit === undefined || !Number.isFinite(perUnit)) return null;
  return Math.round(amount * perUnit * 100) / 100;
}

type FetchLike = typeof fetch;

export class ExchangeRateService {
  private cached: { table: RateTable; exp: number } | null = null;

  constructor(
    private readonly options: {
      fetchImpl?: FetchLike;
      now?: () => number;
      ttlMs?: number;
      timeoutMs?: number;
    } = {},
  ) {}

  async table(): Promise<RateTable | null> {
    const now = this.options.now ?? Date.now;
    if (this.cached && this.cached.exp > now()) return this.cached.table;

    const fetched = (await this.loadCnb()) ?? (await this.loadEcb());
    if (fetched) {
      this.cached = { table: fetched, exp: now() + (this.options.ttlMs ?? 12 * 60 * 60 * 1000) };
      return fetched;
    }
    return this.cached?.table ?? null;
  }

  private async loadCnb(): Promise<RateTable | null> {
    const body = await this.read(CNB_DAILY_URL);
    if (!body) return null;
    try {
      return parseCnbDaily(JSON.parse(body) as unknown);
    } catch {
      return null;
    }
  }

  private async loadEcb(): Promise<RateTable | null> {
    const body = await this.read(ECB_DAILY_URL);
    if (!body) return null;
    try {
      return parseEcbDaily(body);
    } catch {
      return null;
    }
  }

  private async read(url: string): Promise<string | null> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const timeoutMs = this.options.timeoutMs ?? 8_000;
    try {
      const response = await fetchImpl(url, {
        headers: { Accept: "application/json, application/xml, text/xml;q=0.9", "User-Agent": "DamedilySearch/0.1 (+https://damedily.cz)" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) return null;
      return await response.text();
    } catch {
      return null;
    }
  }
}
