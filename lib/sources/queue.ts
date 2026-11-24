import { isCacheableOem, normalizeOem } from "@/lib/sources/oem";

export type OemJob = {
  oem: string;
  source: string;
};

export type JobEnqueueResult = {
  accepted: boolean;
};

export interface JobQueue {
  /** Druhá úloha se stejným normalizovaným OEM a zdrojem se nezařadí, dokud se klíč neuvolní. */
  enqueue(job: OemJob): Promise<JobEnqueueResult>;
}

export interface ReleasableJobQueue extends JobQueue {
  readonly jobs: OemJob[];
  release(job: OemJob): void;
}

const SOURCE_ID = /^[a-z][a-z0-9_]{0,40}$/;

export function canonicalizeJob(job: OemJob): OemJob | null {
  const oem = normalizeOem(job.oem);
  const source = job.source.trim();
  if (!isCacheableOem(oem) || !SOURCE_ID.test(source)) return null;
  return { oem, source };
}

export function jobKey(job: OemJob): string {
  return `${job.oem}\0${job.source}`;
}

/** Fronta v paměti. Drží klíč, dokud ho `release` neuvolní. */
export class InMemoryJobQueue implements ReleasableJobQueue {
  readonly jobs: OemJob[] = [];
  private readonly inflight = new Set<string>();

  async enqueue(job: OemJob): Promise<JobEnqueueResult> {
    const canonical = canonicalizeJob(job);
    if (!canonical) return { accepted: false };
    const key = jobKey(canonical);
    if (this.inflight.has(key)) return { accepted: false };
    this.inflight.add(key);
    this.jobs.push(canonical);
    return { accepted: true };
  }

  release(job: OemJob): void {
    const canonical = canonicalizeJob(job);
    if (!canonical) return;
    this.inflight.delete(jobKey(canonical));
  }
}

/**
 * Binding Cloudflare Queues, jak ho má Worker (`queue.send`).
 * Balíček Workers ani wrangler tu nejsou; tohle je jen tvar volání.
 */
export type CloudflareQueueBinding = {
  send(
    message: OemJob,
    options?: { contentType?: "json" | "text" | "bytes" | "v8"; delaySeconds?: number },
  ): Promise<void>;
};

/**
 * Pošle úlohu do Cloudflare Queues. Stejný klíč (oem, source) se z tohoto procesu
 * neodešle podruhé, dokud se neuvolní. Druhé doručení z jiné izolace zachytí worker přes cache.
 */
export function createCloudflareJobQueue(binding: CloudflareQueueBinding): ReleasableJobQueue {
  const seen = new Set<string>();
  const pending: OemJob[] = [];

  return {
    jobs: pending,
    async enqueue(job) {
      const canonical = canonicalizeJob(job);
      if (!canonical) return { accepted: false };
      const key = jobKey(canonical);
      if (seen.has(key)) return { accepted: false };
      seen.add(key);
      try {
        await binding.send(canonical, { contentType: "json" });
      } catch (error) {
        seen.delete(key);
        throw error;
      }
      pending.push(canonical);
      return { accepted: true };
    },
    release(job) {
      const canonical = canonicalizeJob(job);
      if (!canonical) return;
      seen.delete(jobKey(canonical));
    },
  };
}
