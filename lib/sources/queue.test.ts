import { describe, expect, it } from "vitest";
import { createCloudflareJobQueue, InMemoryJobQueue } from "./queue";

describe("InMemoryJobQueue", () => {
  it("stejné OEM a zdroj vezme jednou a jiné dvojice nechá", async () => {
    const queue = new InMemoryJobQueue();
    expect((await queue.enqueue({ oem: "1k0 615.301", source: "allegro" })).accepted).toBe(true);
    expect((await queue.enqueue({ oem: "1K0.615.301", source: "allegro" })).accepted).toBe(false);
    expect((await queue.enqueue({ oem: "1K0615301", source: "fake" })).accepted).toBe(true);
    expect((await queue.enqueue({ oem: "JINE1", source: "allegro" })).accepted).toBe(true);
    expect(queue.jobs).toEqual([
      { oem: "1K0615301", source: "allegro" },
      { oem: "1K0615301", source: "fake" },
      { oem: "JINE1", source: "allegro" },
    ]);
  });

  it("po uvolnění stejný klíč vezme znovu a prázdné OEM ne", async () => {
    const queue = new InMemoryJobQueue();
    await queue.enqueue({ oem: "1K0615301", source: "allegro" });
    queue.release({ oem: "1k0-615-301", source: "allegro" });
    expect((await queue.enqueue({ oem: "1K0615301", source: "allegro" })).accepted).toBe(true);
    expect((await queue.enqueue({ oem: " . - ", source: "allegro" })).accepted).toBe(false);
    expect((await queue.enqueue({ oem: "A/B", source: "allegro" })).accepted).toBe(false);
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
    expect((await queue.enqueue({ oem: "1K0615301", source: "allegro" })).accepted).toBe(false);
    expect(sent).toEqual([{ body: { oem: "1K0615301", source: "allegro" }, contentType: "json" }]);
  });
});
