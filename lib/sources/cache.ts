import { isCacheableOem } from "@/lib/sources/oem";
import { isSourceOffer, type SourceOffer } from "@/lib/sources/types";

export type OemCacheRow = {
  oem: string;
  source: string;
  payload: SourceOffer[];
  fetchedAt: string;
  ttlMs: number;
};

export interface OemCache {
  /** Čerstvý řádek, nebo null když chybí, vypršel, nebo nejde přečíst. */
  read(oem: string, source: string, now: Date): Promise<OemCacheRow | null>;
  write(row: OemCacheRow): Promise<void>;
  /** true, když tento worker smí zdroj zavolat. false, když lease drží někdo jiný. */
  tryLease?(oem: string, source: string, until: Date): Promise<boolean>;
  releaseLease?(oem: string, source: string): Promise<void>;
}

export function cacheKey(oem: string, source: string): string {
  return `${oem}\0${source}`;
}

/** Postgres `interval` z PostgREST (`01:00:00`, `1 day`, `21600 seconds`) na milisekundy. */
export function intervalToMs(value: string): number | null {
  const trimmed = value.trim();
  const seconds = /^(\d+(?:\.\d+)?) seconds?$/.exec(trimmed);
  if (seconds) return Math.round(Number(seconds[1]) * 1000);

  const daysOnly = /^(\d+) days?$/.exec(trimmed);
  if (daysOnly) return Number(daysOnly[1]) * 86_400_000;

  const clock = /^(?:(\d+) days?\s+)?(\d+):(\d{2}):(\d{2})(?:\.\d+)?$/.exec(trimmed);
  if (!clock) return null;
  const days = Number(clock[1] ?? 0);
  const hours = Number(clock[2]);
  const minutes = Number(clock[3]);
  const secs = Number(clock[4]);
  if (minutes > 59 || secs > 59) return null;
  return ((days * 24 + hours) * 3600 + minutes * 60 + secs) * 1000;
}

export function cacheRowFresh(row: OemCacheRow, now: Date): boolean {
  const fetched = Date.parse(row.fetchedAt);
  if (Number.isNaN(fetched) || row.ttlMs <= 0) return false;
  return fetched + row.ttlMs > now.getTime();
}

export function isCacheableSource(source: string): boolean {
  return /^[a-z][a-z0-9_]{0,40}$/.test(source);
}

export function parseCachedOffers(value: unknown): SourceOffer[] | null {
  if (!Array.isArray(value) || !value.every(isSourceOffer)) return null;
  return value;
}

/** Paměťová cache pro testy a worker bez Postgresu. */
export class MemoryOemCache implements OemCache {
  readonly rows = new Map<string, OemCacheRow>();
  private readonly leases = new Map<string, number>();

  async read(oem: string, source: string, now: Date): Promise<OemCacheRow | null> {
    const row = this.rows.get(cacheKey(oem, source));
    if (!row || !cacheRowFresh(row, now)) return null;
    return row;
  }

  async write(row: OemCacheRow): Promise<void> {
    if (!isCacheableOem(row.oem) || !isCacheableSource(row.source)) {
      throw new TypeError("Do cache patří jen cacheovatelné OEM a id zdroje.");
    }
    this.leases.delete(cacheKey(row.oem, row.source));
    this.rows.set(cacheKey(row.oem, row.source), row);
  }

  async tryLease(oem: string, source: string, until: Date): Promise<boolean> {
    const key = cacheKey(oem, source);
    const held = this.leases.get(key);
    if (held !== undefined && held > Date.now()) return false;
    this.leases.set(key, until.getTime());
    return true;
  }

  async releaseLease(oem: string, source: string): Promise<void> {
    this.leases.delete(cacheKey(oem, source));
  }
}
