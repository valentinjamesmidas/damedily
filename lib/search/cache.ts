type Entry = { value: unknown; exp: number };

/** Krátká paměť procesu. Po vypršení se záznam už nevrátí. */
export class TtlCache {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly now: () => number = Date.now) {}

  get<T>(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.exp <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    if (ttlMs <= 0) return;
    this.entries.set(key, { value, exp: this.now() + ttlMs });
  }
}
