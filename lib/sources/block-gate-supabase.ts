import "server-only";

import {
  readBlockThreshold,
  readBlockWindowMs,
  type BlockKind,
  type SourceBlockGate,
  type SourceLogger,
} from "@/lib/sources/block-gate";

export function supabaseServiceEnv(env: Record<string, string | undefined>): { url: string; key: string } | null {
  const url = (env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (!url || !key) return null;
  return { url, key };
}

function headers(key: string): Record<string, string> {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

/**
 * Produkční brána. Počet 403 a captcha píše do `source_health` a při dalším
 * startu ho odtamtud čte. Paměťová `BlockGate` je jen pro testy.
 */
export function createSupabaseBlockGate(
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch = fetch,
  options: { threshold?: number; windowMs?: number; log?: SourceLogger } = {},
): SourceBlockGate {
  const target = supabaseServiceEnv(env);
  const threshold = options.threshold ?? readBlockThreshold(env);
  const windowMs = options.windowMs ?? readBlockWindowMs(env);
  const log = options.log ?? ((message) => console.warn(`[sources] ${message}`));

  async function rpc(name: string, body: Record<string, unknown>): Promise<unknown> {
    if (!target) throw new Error("Supabase pro source_health není nastavené.");
    const response = await fetchImpl(`${target.url}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: headers(target.key),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) throw new Error(`${name} selhal (${response.status}).`);
    const text = await response.text();
    if (!text) return null;
    return JSON.parse(text) as unknown;
  }

  async function isTripped(sourceId: string): Promise<boolean> {
    if (!target) return false;
    const params = new URLSearchParams();
    params.set("select", "tripped_at");
    params.set("source", `eq.${sourceId}`);
    const response = await fetchImpl(`${target.url}/rest/v1/source_health?${params}`, {
      headers: headers(target.key),
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) throw new Error(`source_health se nepodařilo načíst (${response.status}).`);
    const rows: unknown = await response.json();
    const first = Array.isArray(rows) ? rows[0] : null;
    return Boolean(first && typeof first === "object" && "tripped_at" in first && first.tripped_at);
  }

  return {
    async record(sourceId, kind: BlockKind) {
      const already = await isTripped(sourceId);
      const body = await rpc("record_source_block", {
        p_source: sourceId,
        p_window: `${Math.round(windowMs / 1000)} seconds`,
        p_threshold: threshold,
      });
      const row = Array.isArray(body) ? body[0] : body;
      const tripped = Boolean(row && typeof row === "object" && "tripped" in row && row.tripped === true);
      if (tripped && !already) {
        log(
          `Zdroj ${sourceId} se vypíná po odpovědích 403 nebo captcha (práh ${threshold}, teď ${kind}). Blokaci neobcházíme.`,
        );
      }
    },

    isTripped,

    async reset(sourceId) {
      await rpc("reset_source_health", { p_source: sourceId });
    },
  };
}
