/** Po kolika odpovědích 403 nebo captcha se zdroj vypne. Výchozí je třetí odpověď. */
export const DEFAULT_SOURCE_BLOCK_THRESHOLD = 3;

/** Jak dlouhé okno se počítá. Starší odpovědi se do prahu neberou. Výchozí je hodina. */
export const DEFAULT_SOURCE_BLOCK_WINDOW_MS = 60 * 60 * 1000;

export type BlockKind = "http-403" | "captcha";

export type SourceLogger = (message: string) => void;

/**
 * Vypínač `SOURCE_<ID>`. Chybějící nebo prázdná proměnná zdroj nechává zapnutý.
 * Zapnuto zůstane jen při `1`, `true` nebo `yes`. Jakákoli jiná nastavená hodnota ho vypne.
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

export function readBlockWindowMs(env: Record<string, string | undefined>): number {
  const raw = env.SOURCE_BLOCK_WINDOW_MS;
  if (raw === undefined || raw.trim() === "") return DEFAULT_SOURCE_BLOCK_WINDOW_MS;
  if (!/^\d+$/.test(raw.trim()) || Number(raw.trim()) <= 0) {
    throw new TypeError("SOURCE_BLOCK_WINDOW_MS musí být kladné celé číslo.");
  }
  return Number(raw.trim());
}

export type BlockState = {
  count: number;
  windowStartMs: number;
  trippedAtMs: number | null;
};

/** Jedna 403 nebo captcha. Po vypršení okna se počet vrací na nulu, dokud zdroj není vypnutý. Vypnutí drží do ručního resetu. */
export function nextBlockState(
  previous: BlockState | undefined,
  nowMs: number,
  windowMs: number,
  threshold: number,
): BlockState {
  if (previous?.trippedAtMs != null) return previous;
  const expired = !previous || nowMs - previous.windowStartMs >= windowMs;
  const base: BlockState = expired ? { count: 0, windowStartMs: nowMs, trippedAtMs: null } : previous;
  const count = base.count + 1;
  return {
    count,
    windowStartMs: base.windowStartMs,
    trippedAtMs: count >= threshold ? nowMs : null,
  };
}

/**
 * Počítá 403 a captchu po zdrojích. Po dosažení prahu zdroj vypne a jednou to zapíše.
 * Další požadavek se na zdroj neposílá a blokace se neobchází.
 */
export class BlockGate {
  private readonly states = new Map<string, BlockState>();

  constructor(
    private readonly threshold: number,
    private readonly log: SourceLogger,
    private readonly windowMs: number = DEFAULT_SOURCE_BLOCK_WINDOW_MS,
    private readonly now: () => Date = () => new Date(),
  ) {}

  record(sourceId: string, kind: BlockKind): void {
    const nowMs = this.now().getTime();
    const next = nextBlockState(this.states.get(sourceId), nowMs, this.windowMs, this.threshold);
    const wasTripped = this.states.get(sourceId)?.trippedAtMs != null;
    this.states.set(sourceId, next);
    if (next.trippedAtMs === null || wasTripped) return;
    this.log(
      `Zdroj ${sourceId} se vypíná po ${next.count} odpovědích 403 nebo captcha (práh ${this.threshold}, teď ${kind}). Blokaci neobcházíme.`,
    );
  }

  /** Ruční reset. Okno i počet začínají znovu. */
  reset(sourceId: string): void {
    this.states.delete(sourceId);
  }

  isTripped(sourceId: string): boolean {
    return this.states.get(sourceId)?.trippedAtMs != null;
  }

  count(sourceId: string): number {
    const state = this.states.get(sourceId);
    if (!state) return 0;
    if (state.trippedAtMs == null && this.now().getTime() - state.windowStartMs >= this.windowMs) return 0;
    return state.count;
  }
}
