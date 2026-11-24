import type { OemCache } from "@/lib/sources/cache";
import { canonicalizeJob, type OemJob, type ReleasableJobQueue } from "@/lib/sources/queue";
import type { PartSource } from "@/lib/sources/types";

export type OemJobResult = "cached" | "fetched" | "disabled" | "unknown-source" | "invalid";

export type OemWorkerDeps = {
  sources: readonly PartSource[];
  cache: OemCache;
  ttlMs: number;
  now?: () => Date;
};

/**
 * Zpracuje jednu úlohu. Stejná dvojice (oem, source) je idempotentní:
 * čerstvá cache zdroj znovu nevolá a zápis přepíše stejný řádek.
 * Vypnutý zdroj ani neúspěšné hledání se jako prázdný ceník neukládá.
 */
export async function runOemJob(job: OemJob, deps: OemWorkerDeps): Promise<OemJobResult> {
  const canonical = canonicalizeJob(job);
  if (!canonical) return "invalid";
  const now = (deps.now ?? (() => new Date()))();
  const fresh = await deps.cache.read(canonical.oem, canonical.source, now);
  if (fresh) return "cached";

  const source = deps.sources.find((item) => item.id === canonical.source);
  if (!source) return "unknown-source";

  const before = await source.health();
  if (!before.ok) return "disabled";
  const offers = await source.searchByOem(canonical.oem);
  const after = await source.health();
  if (!after.ok) return "disabled";

  const fetchedAt = (deps.now ?? (() => new Date()))();
  await deps.cache.write({
    oem: canonical.oem,
    source: canonical.source,
    payload: offers,
    fetchedAt: fetchedAt.toISOString(),
    ttlMs: deps.ttlMs,
  });
  return "fetched";
}

export async function drainInMemoryQueue(queue: ReleasableJobQueue, deps: OemWorkerDeps): Promise<OemJobResult[]> {
  const results: OemJobResult[] = [];
  for (;;) {
    const job = queue.jobs.shift();
    if (!job) return results;
    try {
      results.push(await runOemJob(job, deps));
    } finally {
      queue.release(job);
    }
  }
}

export type CloudflareQueueMessage = {
  body: OemJob;
  ack(): void;
  retry(): void;
};

/** Tvar spotřebitele Cloudflare Queues. Nasazení workeru tu není. */
export async function consumeOemQueueBatch(
  messages: readonly CloudflareQueueMessage[],
  deps: OemWorkerDeps,
): Promise<void> {
  for (const message of messages) {
    try {
      await runOemJob(message.body, deps);
      message.ack();
    } catch {
      message.retry();
    }
  }
}
