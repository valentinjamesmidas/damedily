import { describe, expect, it } from "vitest";
import { createCloudflareJobQueue, InMemoryJobQueue } from "./queue";

describe("InMemoryJobQueue", () => {
  it("stejné OEM zařadí znovu a dedup nechá cache", async () => {
    const queue = new InMemoryJobQueue();
    expect((await queue.enqueue({ oem: "1k0 615.301", source: "allegro" })).accepted).toBe(true);
    expect((await queue.enqueue({ oem: "1K0.615.301", source: "allegro" })).accepted).toBe(true);
    expect((await queue.enqueue({ oem: "1K0/615301", source: "fake" })).accepted).toBe(true);
    expect(queue.jobs.map((job) => ({ oem: job.oem, raw: job.raw, source: job.source }))).toEqual([
      { oem: "1K0615301", raw: "1k0 615.301", source: "allegro" },
      { oem: "1K0615301", raw: "1K0.615.301", source: "allegro" },
      { oem: "1K0615301", raw: "1K0/615301", source: "fake" },
    ]);
  });

  it("prázdné OEM a špatné id zdroje nezařadí", async () => {
    const queue = new InMemoryJobQueue();
    expect((await queue.enqueue({ oem: " . - ", source: "allegro" })).accepted).toBe(false);
    expect((await queue.enqueue({ oem: "ABC", source: "Allegro" })).accepted).toBe(false);
  });
});

describe("createCloudflareJobQueue", () => {
  it("pošle normalizovaný JSON jednou a při chybě klíč uvolní", async () => {
    const sent: { body: unknown; contentType: string | undefined }[] = [];
    let fail = true;
    const queue = createCloudflareJobQueue({
      async send(message, options) {
        if (fail) throw new Error("síť");
        sent.push({ body: message, contentType: options?.contentType });
      },
    });

    await expect(queue.enqueue({ oem: "1k0 615.301", source: "allegro" })).rejects.toThrow("síť");
    fail = false;
    expect((await queue.enqueue({ oem: "1K0.615.301", source: "allegro" })).accepted).toBe(true);
    expect((await queue.enqueue({ oem: "1K0615301", source: "allegro" })).accepted).toBe(true);
    expect(sent).toHaveLength(2);
    expect(sent[0]?.contentType).toBe("json");
    expect(sent[1]?.contentType).toBe("json");
  });
});
