/** Po kolika odpovědích 403 nebo captcha se zdroj vypne. Výchozí je třetí odpověď. */
export const DEFAULT_SOURCE_BLOCK_THRESHOLD = 3;

export type BlockKind = "http-403" | "captcha";

export type SourceLogger = (message: string) => void;

/**
 * Vypínač `SOURCE_<ID>`. Prázdná nebo chybějící proměnná zdroj nechává zapnutý.
 * `0`, `false`, `no` i jakákoli jiná hodnota ho vypne.
 */
export function sourceFlagEnabled(sourceId: string, env: Record<string, string | undefined>): boolean {
  if (!/^[a-z][a-z0-9_]*$/.test(sourceId)) {
    throw new TypeError("Id zdroje smí obsahovat jen malá písmena, číslice a podtržítko.");
  }
  const raw = env[`SOURCE_${sourceId.toUpperCase()}`];
  if (raw === undefined || raw.trim() === "") return true;
  return raw === "1" || raw.toLowerCase() === "true" || raw.toLowerCase() === "yes";
}

export function readBlockThreshold(env: Record<string, string | undefined>): number {
  const raw = env.SOURCE_BLOCK_THRESHOLD;
  if (raw === undefined || raw.trim() === "") return DEFAULT_SOURCE_BLOCK_THRESHOLD;
  if (!/^\d+$/.test(raw.trim())) {
    throw new TypeError("SOURCE_BLOCK_THRESHOLD musí být nezáporné celé číslo.");
  }
  return Number(raw.trim());
}

/**
 * Počítá 403 a captchu po zdrojích. Po dosažení prahu zdroj vypne a jednou to zapíše.
 * Další požadavek se na zdroj neposílá a blokace se neobchází.
 */
export class BlockGate {
  private readonly counts = new Map<string, number>();
  private readonly tripped = new Set<string>();

  constructor(
    private readonly threshold: number,
    private readonly log: SourceLogger,
  ) {}

  record(sourceId: string, kind: BlockKind): void {
    const next = (this.counts.get(sourceId) ?? 0) + 1;
    this.counts.set(sourceId, next);
    if (next < this.threshold || this.tripped.has(sourceId)) return;
    this.tripped.add(sourceId);
    this.log(
      `Zdroj ${sourceId} se vypíná po ${next} odpovědích 403 nebo captcha (práh ${this.threshold}, teď ${kind}). Blokaci neobcházíme.`,
    );
  }

  isTripped(sourceId: string): boolean {
    return this.tripped.has(sourceId);
  }

  count(sourceId: string): number {
    return this.counts.get(sourceId) ?? 0;
  }
}
