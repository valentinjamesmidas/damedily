import type { OemCache } from "@/lib/sources/cache";
import { canonicalizeJob, type OemJob, type ReleasableJobQueue } from "@/lib/sources/queue";
import type { PartSource, SourceSearchFailure } from "@/lib/sources/types";

export type OemJobResult =
  | "cached"
  | "fetched"
  | "disabled"
  | "unknown-source"
  | "invalid"
  | "leased"
  | { error: string; retryAfterSeconds?: number; attempt: number };

export type OemWorkerDeps = {
  sources: readonly PartSource[];
  cache: OemCache;
  ttlMs: number;
  leaseMs?: number;
  now?: () => Date;
};

const MAX_RETRY_DELAY_SECONDS = 900;

/**
 * Exponenciální čekání pro všechny zdroje. Když zdroj pošle Retry-After,
 * bere se delší z obou hodnot, nejvýš 15 minut.
 */
export function retryDelaySeconds(attempt: number, retryAfterSeconds?: number): number {
  const safeAttempt = Number.isFinite(attempt) && attempt > 0 ? Math.min(attempt, 8) : 0;
  const exponential = Math.min(MAX_RETRY_DELAY_SECONDS, 2 ** safeAttempt);
  const hinted = retryAfterSeconds !== undefined && retryAfterSeconds > 0 ? retryAfterSeconds : 0;
  return Math.max(1, Math.min(MAX_RETRY_DELAY_SECONDS, Math.max(exponential, hinted)));
}

function failureOf(failure: SourceSearchFailure, attempt: number): OemJobResult {
  return {
    error: failure.error,
    retryAfterSeconds: failure.retryAfterSeconds,
    attempt,
  };
}

/**
 * Zpracuje jednu úlohu. Stejná dvojice (oem, source) je idempotentní přes čerstvou
 * cache nebo lease `in_flight_until`. Do cache se zapisuje jen úspěch, i když je
 * seznam nabídek prázdný. Chyba se neukládá a fronta ji má zkusit znovu.
 */
export async function runOemJob(job: OemJob, deps: OemWorkerDeps): Promise<OemJobResult> {
  const canonical = canonicalizeJob(job);
  if (!canonical) return "invalid";
  const attempt = job.attempt ?? 0;
  const now = (deps.now ?? (() => new Date()))();
  const fresh = await deps.cache.read(canonical.oem, canonical.source, now);
  if (fresh) return "cached";

  if (deps.cache.tryLease) {
    const until = new Date(now.getTime() + (deps.leaseMs ?? 60_000));
    const acquired = await deps.cache.tryLease(canonical.oem, canonical.source, until);
    if (!acquired) return "leased";
  }

  const source = deps.sources.find((item) => item.id === canonical.source);
  if (!source) {
    await deps.cache.releaseLease?.(canonical.oem, canonical.source);
    return "unknown-source";
  }

  const before = await source.health();
  if (!before.ok) {
    await deps.cache.releaseLease?.(canonical.oem, canonical.source);
    return "disabled";
  }

  let result;
  try {
    result = await source.searchByOem(job.raw ?? job.oem);
  } catch (error) {
    await deps.cache.releaseLease?.(canonical.oem, canonical.source);
    const message = error instanceof Error ? error.message : "zdroj spadl";
    return { error: message, attempt };
  }

  if (!result.ok) {
    await deps.cache.releaseLease?.(canonical.oem, canonical.source);
    if (!result.retryable) return "disabled";
    return failureOf(result, attempt);
  }

  const after = await source.health();
  if (!after.ok) {
    await deps.cache.releaseLease?.(canonical.oem, canonical.source);
    return "disabled";
  }

  const fetchedAt = (deps.now ?? (() => new Date()))();
  await deps.cache.write({
    oem: canonical.oem,
    source: canonical.source,
    payload: result.offers,
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
    results.push(await runOemJob(job, deps));
  }
}

export type CloudflareQueueMessage = {
  body: OemJob;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
};

/** Tvar spotřebitele Cloudflare Queues. Nasazení workeru tu není. */
export async function consumeOemQueueBatch(
  messages: readonly CloudflareQueueMessage[],
  deps: OemWorkerDeps,
): Promise<void> {
  for (const message of messages) {
    try {
      const result = await runOemJob(message.body, deps);
      if (typeof result === "object") {
        message.retry({
          delaySeconds: retryDelaySeconds(result.attempt, result.retryAfterSeconds),
        });
        continue;
      }
      message.ack();
    } catch {
      message.retry({
        delaySeconds: retryDelaySeconds(message.body.attempt ?? 0),
      });
    }
  }
}
