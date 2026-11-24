import { describe, expect, it } from "vitest";
import { MemoryOemCache } from "./cache";
import { InMemoryJobQueue } from "./queue";
import type { PartSource, SourceOffer } from "./types";
import { consumeOemQueueBatch, drainInMemoryQueue, runOemJob } from "./worker";

const fetchedAt = "2026-11-24T12:00:00.000Z";
const now = () => new Date(fetchedAt);

const offer: SourceOffer = {
  source: "allegro",
  oem: "1K0615301",
  name: "Wahacz",
  condition: "used",
  price: { amount: 123.45, currency: "PLN" },
  availability: "3",
  url: "https://allegro.pl/oferta/10000000001",
  fetchedAt,
};

function source(options: { enabled?: boolean; id?: string } = {}): PartSource & { calls: number } {
  const enabled = options.enabled ?? true;
  const api: PartSource & { calls: number } = {
    id: options.id ?? "allegro",
    calls: 0,
    async health() {
      return enabled ? { ok: true, detail: "zapnuto" } : { ok: false, detail: "vypnuto" };
    },
    async searchByOem() {
      api.calls += 1;
      return [offer];
    },
  };
  return api;
}

describe("runOemJob", () => {
  it("je idempotentní podle OEM a zdroje", async () => {
    const allegro = source();
    const deps = { sources: [allegro], cache: new MemoryOemCache(), ttlMs: 3_600_000, now };
    expect(await runOemJob({ oem: "1k0 615.301", source: "allegro" }, deps)).toBe("fetched");
    expect(await runOemJob({ oem: "1K0.615.301", source: "allegro" }, deps)).toBe("cached");
    expect(allegro.calls).toBe(1);
    expect((await deps.cache.read("1K0615301", "allegro", now()))?.payload).toEqual([offer]);
  });

  it("vypnutý zdroj neukládá prázdný ceník a neznámý zdroj nespadne", async () => {
    const allegro = source({ enabled: false });
    const deps = { sources: [allegro], cache: new MemoryOemCache(), ttlMs: 3_600_000, now };
    expect(await runOemJob({ oem: "1K0615301", source: "allegro" }, deps)).toBe("disabled");
    expect(allegro.calls).toBe(0);
    expect(await deps.cache.read("1K0615301", "allegro", now())).toBeNull();
    expect(await runOemJob({ oem: "1K0615301", source: "jiny" }, deps)).toBe("unknown-source");
    expect(await runOemJob({ oem: "---", source: "allegro" }, deps)).toBe("invalid");
  });

  it("po blokaci uprostřed hledání cache nezapíše", async () => {
    let enabled = true;
    const allegro: PartSource = {
      id: "allegro",
      async health() {
        return enabled ? { ok: true, detail: "zapnuto" } : { ok: false, detail: "blokace" };
      },
      async searchByOem() {
        enabled = false;
        return [];
      },
    };
    const deps = { sources: [allegro], cache: new MemoryOemCache(), ttlMs: 3_600_000, now };
    expect(await runOemJob({ oem: "1K0615301", source: "allegro" }, deps)).toBe("disabled");
    expect(await deps.cache.read("1K0615301", "allegro", now())).toBeNull();
  });
});

describe("drainInMemoryQueue", () => {
  it("druhý enqueue stejného klíče nehledá znovu", async () => {
    const allegro = source();
    const queue = new InMemoryJobQueue();
    const deps = { sources: [allegro], cache: new MemoryOemCache(), ttlMs: 3_600_000, now };
    expect((await queue.enqueue({ oem: "1k0 615.301", source: "allegro" })).accepted).toBe(true);
    expect((await queue.enqueue({ oem: "1K0615301", source: "allegro" })).accepted).toBe(false);
    expect(await drainInMemoryQueue(queue, deps)).toEqual(["fetched"]);
    expect((await queue.enqueue({ oem: "1K0-615-301", source: "allegro" })).accepted).toBe(true);
    expect(await drainInMemoryQueue(queue, deps)).toEqual(["cached"]);
    expect(allegro.calls).toBe(1);
  });
});

describe("consumeOemQueueBatch", () => {
  it("druhou zprávu vezme z cache a při chybě zápisu zprávu vrátí", async () => {
    const allegro = source();
    const deps = { sources: [allegro], cache: new MemoryOemCache(), ttlMs: 3_600_000, now };
    const acks: string[] = [];
    const retries: string[] = [];
    await consumeOemQueueBatch(
      [
        {
          body: { oem: "1k0 615.301", source: "allegro" },
          ack: () => acks.push("first"),
          retry: () => retries.push("first"),
        },
        {
          body: { oem: "1K0615301", source: "allegro" },
          ack: () => acks.push("second"),
          retry: () => retries.push("second"),
        },
      ],
      deps,
    );
    expect(acks).toEqual(["first", "second"]);
    expect(retries).toEqual([]);
    expect(allegro.calls).toBe(1);

    const failing = {
      ...deps,
      cache: {
        async read() {
          return null;
        },
        async write() {
          throw new Error("db");
        },
      },
    };
    const again: string[] = [];
    const againRetry: string[] = [];
    await consumeOemQueueBatch(
      [
        {
          body: { oem: "JINE1", source: "allegro" },
          ack: () => again.push("ack"),
          retry: () => againRetry.push("retry"),
        },
      ],
      failing,
    );
    expect(again).toEqual([]);
    expect(againRetry).toEqual(["retry"]);
  });
});
