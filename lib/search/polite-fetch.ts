import { detectPublicBlock } from "@/lib/search/block";
import { TtlCache } from "@/lib/search/cache";
import { robotsAllows, robotsRulesFor, type RobotsRule } from "@/lib/search/robots";

export const SEARCH_USER_AGENT = "DamedilySearch/0.1 (+https://damedily.cz; server-side parts search)";

const MAX_BODY_BYTES = 512_000;

export type PublicPage = {
  outcome: "ok" | "blocked" | "skipped" | "error";
  status: number;
  body: string;
  detail: string;
  finalUrl: string;
  fromCache: boolean;
};

type FetchLike = typeof fetch;

/**
 * Jeden zdvořilý požadavek na veřejnou stránku.
 * Drží robots.txt, nízkou frekvenci, vlastní User-Agent a při blokaci se neopakuje.
 */
export class PoliteFetch {
  private readonly nextAt = new Map<string, number>();
  private readonly cache: TtlCache;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;

  constructor(
    private readonly options: {
      fetchImpl?: FetchLike;
      cache?: TtlCache;
      now?: () => number;
      minIntervalMs?: number;
      cacheTtlMs?: number;
      timeoutMs?: number;
      userAgent?: string;
    } = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.cache = options.cache ?? new TtlCache(this.now);
  }

  async fetchText(source: string, url: string): Promise<PublicPage> {
    const key = `page:${source}:${url}`;
    const cached = this.cache.get<PublicPage>(key);
    if (cached) return { ...cached, fromCache: true };

    let target: URL;
    try {
      target = new URL(url);
    } catch {
      return this.miss(key, { outcome: "error", status: 0, body: "", detail: "neplatná adresa", finalUrl: url });
    }
    if (target.protocol !== "https:") {
      return this.miss(key, { outcome: "skipped", status: 0, body: "", detail: "povoleno je jen https", finalUrl: url });
    }

    const rules = await this.rulesFor(target.hostname);
    if (rules.blocked) {
      return this.miss(key, {
        outcome: "blocked",
        status: rules.status,
        body: "",
        detail: rules.detail,
        finalUrl: url,
      });
    }
    const path = `${target.pathname}${target.search}`;
    if (!robotsAllows(rules.rules, path)) {
      return this.miss(key, {
        outcome: "skipped",
        status: 0,
        body: "",
        detail: "robots.txt tuhle adresu zakazuje",
        finalUrl: url,
      });
    }

    const minIntervalMs = this.options.minIntervalMs ?? 8_000;
    const at = this.now();
    const next = this.nextAt.get(target.hostname) ?? 0;
    if (at < next) {
      return {
        outcome: "skipped",
        status: 0,
        body: "",
        detail: "nízká frekvence, další požadavek na tuhle doménu počká",
        finalUrl: url,
        fromCache: false,
      };
    }
    this.nextAt.set(target.hostname, at + minIntervalMs);

    const response = await this.request(url);
    if (!response) {
      return this.miss(key, { outcome: "error", status: 0, body: "", detail: "požadavek selhal", finalUrl: url });
    }
    if (response.tooLarge) {
      return this.miss(key, {
        outcome: "error",
        status: response.status,
        body: "",
        detail: "odpověď je příliš velká",
        finalUrl: response.finalUrl,
      });
    }

    let finalHost = target.hostname;
    try {
      finalHost = new URL(response.finalUrl).hostname;
    } catch {
      finalHost = target.hostname;
    }
    if (finalHost !== target.hostname) {
      return this.miss(key, {
        outcome: "blocked",
        status: response.status,
        body: "",
        detail: "přesměrování na jinou doménu",
        finalUrl: response.finalUrl,
      });
    }

    const block = detectPublicBlock(response.status, response.body, response.challenge);
    if (block) {
      return this.miss(key, {
        outcome: "blocked",
        status: response.status,
        body: response.body,
        detail: block,
        finalUrl: response.finalUrl,
      });
    }
    if (response.status < 200 || response.status >= 300) {
      return this.miss(key, {
        outcome: "error",
        status: response.status,
        body: "",
        detail: `HTTP ${response.status}`,
        finalUrl: response.finalUrl,
      });
    }

    return this.miss(key, {
      outcome: "ok",
      status: response.status,
      body: response.body,
      detail: "veřejná stránka",
      finalUrl: response.finalUrl,
    });
  }

  private miss(key: string, page: Omit<PublicPage, "fromCache">): PublicPage {
    const stored = { ...page, fromCache: false };
    this.cache.set(key, stored, this.options.cacheTtlMs ?? 6 * 60 * 60 * 1000);
    return stored;
  }

  private async rulesFor(
    host: string,
  ): Promise<{ rules: RobotsRule[]; blocked: boolean; detail: string; status: number }> {
    const key = `robots:${host}`;
    const cached = this.cache.get<{ rules: RobotsRule[]; blocked: boolean; detail: string; status: number }>(key);
    if (cached) return cached;

    const response = await this.request(`https://${host}/robots.txt`);
    let decision: { rules: RobotsRule[]; blocked: boolean; detail: string; status: number };
    if (!response) {
      decision = { rules: [], blocked: false, detail: "robots.txt se nepodařilo načíst", status: 0 };
    } else if (response.tooLarge) {
      decision = { rules: [], blocked: true, detail: "robots.txt je příliš velké", status: response.status };
    } else {
      const block = detectPublicBlock(response.status, response.body, response.challenge);
      if (block) {
        decision = { rules: [], blocked: true, detail: `robots.txt: ${block}`, status: response.status };
      } else if (response.status === 404) {
        decision = { rules: [], blocked: false, detail: "robots.txt není", status: 404 };
      } else if (response.status < 200 || response.status >= 300) {
        decision = { rules: [], blocked: true, detail: `robots.txt HTTP ${response.status}`, status: response.status };
      } else {
        decision = {
          rules: robotsRulesFor(response.body, this.options.userAgent ?? SEARCH_USER_AGENT),
          blocked: false,
          detail: "robots.txt",
          status: response.status,
        };
      }
    }
    this.cache.set(key, decision, this.options.cacheTtlMs ?? 6 * 60 * 60 * 1000);
    return decision;
  }

  private async request(url: string): Promise<{
    status: number;
    body: string;
    finalUrl: string;
    challenge: string | null;
    tooLarge: boolean;
  } | null> {
    try {
      const response = await this.fetchImpl(url, {
        redirect: "follow",
        headers: {
          "User-Agent": this.options.userAgent ?? SEARCH_USER_AGENT,
          Accept: "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.8",
          "Accept-Language": "cs,en;q=0.8",
        },
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 8_000),
      });
      const challenge = response.headers.get("cf-mitigated");
      const reader = response.body?.getReader();
      if (!reader) {
        const text = await response.text();
        return {
          status: response.status,
          body: text.slice(0, MAX_BODY_BYTES),
          finalUrl: response.url || url,
          challenge,
          tooLarge: text.length > MAX_BODY_BYTES,
        };
      }

      const chunks: Uint8Array[] = [];
      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        received += value.byteLength;
        if (received > MAX_BODY_BYTES) {
          await reader.cancel();
          return { status: response.status, body: "", finalUrl: response.url || url, challenge, tooLarge: true };
        }
        chunks.push(value);
      }
      const body = new TextDecoder().decode(Buffer.concat(chunks));
      return { status: response.status, body, finalUrl: response.url || url, challenge, tooLarge: false };
    } catch {
      return null;
    }
  }
}
