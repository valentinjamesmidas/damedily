import { describe, expect, it } from "vitest";

import { BlockGate, type SourceBlockGate } from "@/lib/sources/block-gate";
import type { OemCache, OemCacheRow } from "@/lib/sources/cache";

const OEM = "CONTRACTOEM1";
const SOURCE = "allegro";
const GATE = "contractgate";

function row(now: Date, ttlMs: number): OemCacheRow {
  return {
    oem: OEM,
    source: SOURCE,
    payload: [],
    fetchedAt: now.toISOString(),
    ttlMs,
  };
}

/** Stejná smlouva pro paměťovou cache i pro Postgres. */
export function defineOemCacheContract(name: string, open: () => Promise<OemCache> | OemCache): void {
  describe(`smlouva OemCache (${name})`, () => {
    it("čerstvý řádek lease nepustí a prošlý drží jen jeden worker", async () => {
      const cache = await open();
      const now = new Date();
      await cache.write(row(now, 3_600_000));
      expect(await cache.read(OEM, SOURCE, now)).not.toBeNull();
      expect(await cache.tryLease(OEM, SOURCE, new Date(now.getTime() + 60_000), now)).toBe(false);

      const stale = new Date(now.getTime() - 10_000);
      await cache.write(row(stale, 1_000));
      const at = new Date();
      const until = new Date(at.getTime() + 60_000);
      expect(await cache.tryLease(OEM, SOURCE, until, at)).toBe(true);
      expect(await cache.tryLease(OEM, SOURCE, until, at)).toBe(false);
      await cache.releaseLease(OEM, SOURCE);
      expect(await cache.tryLease(OEM, SOURCE, until, at)).toBe(true);
    });
  });
}

/** Stejná smlouva pro paměťovou bránu i pro source_health. */
export function defineBlockGateContract(name: string, open: () => SourceBlockGate): void {
  describe(`smlouva brány (${name})`, () => {
    it("třetí 403 zdroj vypne a reset ho vrátí", async () => {
      const gate = open();
      await gate.reset(GATE);
      await gate.record(GATE, "http-403");
      await gate.record(GATE, "http-403");
      expect(await gate.isTripped(GATE)).toBe(false);
      await gate.record(GATE, "http-403");
      expect(await gate.isTripped(GATE)).toBe(true);
      await gate.reset(GATE);
      expect(await gate.isTripped(GATE)).toBe(false);
    });
  });
}

export function memoryBlockGate(): SourceBlockGate {
  return new BlockGate(3, () => {});
}
