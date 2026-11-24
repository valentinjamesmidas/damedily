import { isCacheableOem, normalizeOem } from "@/lib/sources/oem";

export type OemJob = {
  /** Kompaktní klíč cache. Před `canonicalizeJob` smí být i původní tvar. */
  oem: string;
  /** Původní tvar, který se zdroji pošle spolu s kompaktním. */
  raw?: string;
  source: string;
  attempt?: number;
};

export type JobEnqueueResult = {
  accepted: boolean;
};

export interface JobQueue {
  /** Zařadí úlohu. Stejný klíč se smí poslat znovu; dedup drží cache a lease. */
  enqueue(job: OemJob): Promise<JobEnqueueResult>;
}

export interface ReleasableJobQueue extends JobQueue {
  readonly jobs: OemJob[];
}

const SOURCE_ID = /^[a-z][a-z0-9_]{0,40}$/;

export function canonicalizeJob(job: OemJob): OemJob | null {
  const raw = (job.raw ?? job.oem).trim();
  const oem = normalizeOem(raw);
  const source = job.source.trim();
  if (!isCacheableOem(oem) || !SOURCE_ID.test(source)) return null;
  return job.attempt === undefined ? { oem, raw, source } : { oem, raw, source, attempt: job.attempt };
}

/** Fronta v paměti pro testy. Stejný klíč se může zařadit víckrát; dedup drží cache a lease. */
export class InMemoryJobQueue implements ReleasableJobQueue {
  readonly jobs: OemJob[] = [];

  async enqueue(job: OemJob): Promise<JobEnqueueResult> {
    const canonical = canonicalizeJob(job);
    if (!canonical) return { accepted: false };
    this.jobs.push(canonical);
    return { accepted: true };
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
 * Pošle úlohu do Cloudflare Queues. Deduplikace v producentovi není:
 * stejný klíč se smí poslat znovu, worker ho vezme jen při čerstvé cache nebo platném lease.
 */
export function createCloudflareJobQueue(binding: CloudflareQueueBinding): ReleasableJobQueue {
  const pending: OemJob[] = [];

  return {
    jobs: pending,
    async enqueue(job) {
      const canonical = canonicalizeJob(job);
      if (!canonical) return { accepted: false };
      await binding.send(canonical, { contentType: "json" });
      pending.push(canonical);
      return { accepted: true };
    },
  };
}
