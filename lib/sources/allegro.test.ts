import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ALLEGRO_ACCEPT,
  ALLEGRO_LISTING_URL,
  ALLEGRO_TOKEN_URL,
  ALLEGRO_USER_AGENT,
  allegroConditionQueries,
  conditionFromStanValue,
  createAllegroSource,
  mapAllegroListing,
} from "./allegro";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/allegro/${name}`, import.meta.url)), "utf8");
}

const filters = JSON.parse(fixture("listing-filters.json")) as unknown;
const used = JSON.parse(fixture("listing-used.json")) as unknown;
const aftermarket = JSON.parse(fixture("listing-aftermarket.json")) as unknown;
const fetchedAt = "2026-11-24T12:00:00.000Z";

describe("mapování Allegra", () => {
  it("ze stavu filtru vezme used a aftermarket a nowe nechá být", () => {
    expect(conditionFromStanValue("używane")).toBe("used");
    expect(conditionFromStanValue("Używane")).toBe("used");
    expect(conditionFromStanValue("Używany")).toBe("used");
    expect(conditionFromStanValue("used")).toBe("used");
    expect(conditionFromStanValue("zamiennik")).toBe("aftermarket");
    expect(conditionFromStanValue("aftermarket")).toBe("aftermarket");
    expect(conditionFromStanValue("druhovýroba")).toBe("aftermarket");
    expect(conditionFromStanValue("nowe")).toBeNull();
    expect(conditionFromStanValue("Nowe")).toBeNull();
    expect(conditionFromStanValue("po zwrocie")).toBeNull();
    expect(conditionFromStanValue("")).toBeNull();
  });

  it("z filtru Stan složí jen bezpečné dotazy", () => {
    expect(allegroConditionQueries(filters)).toEqual([
      { id: "parameter.11323", value: "11323_2", condition: "used" },
      { id: "parameter.11323", value: "11323_9", condition: "aftermarket" },
    ]);
    expect(allegroConditionQueries(null)).toEqual([]);
  });

  it("bere cenu nabídky, ne dopravu, a aukci i díru vynechá", () => {
    const offers = mapAllegroListing(used, { oem: "1K0615301", condition: "used", fetchedAt });
    expect(offers).toEqual([
      {
        source: "allegro",
        oem: "1K0615301",
        name: "Wahacz przedni",
        condition: "used",
        price: { amount: 123.45, currency: "PLN" },
        availability: "3",
        url: "https://allegro.pl/oferta/10000000001",
        fetchedAt,
      },
    ]);
    expect(JSON.stringify(offers)).not.toContain("allegroimg");
    expect(JSON.stringify(offers)).not.toContain("12.00");
    expect(JSON.stringify(offers)).not.toContain("999.99");
    expect(mapAllegroListing(aftermarket, { oem: "1K0615301", condition: "aftermarket", fetchedAt })[0]?.condition).toBe(
      "aftermarket",
    );
    expect(mapAllegroListing({}, { oem: "1K0615301", condition: "used", fetchedAt })).toEqual([]);
  });
});

type Call = { url: string; method: string; headers: Headers; body: string | null };

function scriptedFetch(pages: Record<string, { status: number; body: string; headers?: HeadersInit }>) {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({
      url,
      method: init?.method ?? "GET",
      headers,
      body: typeof init?.body === "string" ? init.body : null,
    });
    const parsed = new URL(url);
    const key = parsed.searchParams.get("parameter.11323") ?? (parsed.pathname.endsWith("/token") ? "token" : "listing");
    const page = pages[key];
    if (!page) throw new Error(`neočekávaná adresa ${url}`);
    return new Response(page.body, { status: page.status, headers: page.headers });
  };
  return { calls, fetchImpl };
}

function happyPages() {
  return {
    token: { status: 200, body: fixture("token.json"), headers: { "content-type": "application/json" } },
    listing: { status: 200, body: fixture("listing-filters.json"), headers: { "content-type": "application/vnd.allegro.public.v1+json" } },
    "11323_2": { status: 200, body: fixture("listing-used.json"), headers: { "content-type": "application/vnd.allegro.public.v1+json" } },
    "11323_9": {
      status: 200,
      body: fixture("listing-aftermarket.json"),
      headers: { "content-type": "application/vnd.allegro.public.v1+json" },
    },
  };
}

describe("AllegroSource", () => {
  it("bez klíčů se vypne a síť nevolá", async () => {
    let called = false;
    const source = createAllegroSource({
      env: { SOURCE_ALLEGRO: "1" },
      fetchImpl: async () => {
        called = true;
        throw new Error("síť");
      },
    });
    expect(await source.health()).toEqual({
      ok: false,
      detail: "chybí ALLEGRO_CLIENT_ID nebo ALLEGRO_CLIENT_SECRET",
    });
    expect(await source.searchByOem("1K0615301")).toEqual({ ok: true, offers: [] });
    expect(called).toBe(false);
  });

  it("vypínač SOURCE_ALLEGRO síť nevolá ani s klíči", async () => {
    let called = false;
    const source = createAllegroSource({
      env: { SOURCE_ALLEGRO: "0", ALLEGRO_CLIENT_ID: "client", ALLEGRO_CLIENT_SECRET: "secret" },
      fetchImpl: async () => {
        called = true;
        throw new Error("síť");
      },
    });
    expect((await source.health()).ok).toBe(false);
    expect((await source.health()).detail).toContain("SOURCE_ALLEGRO");
    expect(await source.searchByOem("1K0615301")).toEqual({ ok: true, offers: [] });
    expect(called).toBe(false);
  });

  it("složí nabídky jen z filtrů used a aftermarket", async () => {
    const { calls, fetchImpl } = scriptedFetch(happyPages());
    const lines: string[] = [];
    const source = createAllegroSource({
      env: { ALLEGRO_CLIENT_ID: "client id", ALLEGRO_CLIENT_SECRET: "taj/né:1" },
      fetchImpl,
      now: () => new Date(fetchedAt),
      log: (message) => lines.push(message),
    });
    expect(await source.health()).toEqual({ ok: true, detail: "klíče jsou nastavené" });
    expect(calls).toHaveLength(0);

    const found = await source.searchByOem("1K0615301");
    expect(found.ok).toBe(true);
    if (!found.ok) throw new Error(found.error);
    const offers = found.offers;
    expect(offers.map((offer) => offer.condition)).toEqual(["used", "aftermarket"]);
    expect(offers.map((offer) => offer.oem)).toEqual(["1K0615301", "1K0615301"]);
    expect(offers.map((offer) => offer.url)).toEqual([
      "https://allegro.pl/oferta/10000000001",
      "https://allegro.pl/oferta/10000000002",
    ]);
    expect(offers.map((offer) => offer.price.amount)).toEqual([123.45, 80]);
    expect(JSON.stringify(offers)).not.toContain("999");

    const urls = calls.map((call) => call.url);
    expect(urls.some((url) => url.includes("11323_1"))).toBe(false);
    expect(urls.some((url) => url.includes("11323_238066"))).toBe(false);
    expect(urls.some((url) => url.includes("parameter.500"))).toBe(false);
    expect(urls.some((url) => url.includes(".."))).toBe(false);
    expect(calls[0]?.url).toBe(ALLEGRO_TOKEN_URL);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.body).toBe("grant_type=client_credentials");
    expect(calls[0]?.headers.get("user-agent")).toBe(ALLEGRO_USER_AGENT);
    expect(calls[0]?.headers.get("user-agent")).not.toContain("Mozilla");
    const authorization = calls[0]?.headers.get("authorization") ?? "";
    const decoded = Buffer.from(authorization.replace(/^Basic /, ""), "base64").toString();
    expect(decoded).toBe(`${encodeURIComponent("client id")}:${encodeURIComponent("taj/né:1")}`);
    expect(calls[0]?.url).not.toContain("taj");

    const listing = calls.find((call) => call.url.startsWith(ALLEGRO_LISTING_URL) && !call.url.includes("parameter."));
    expect(listing?.headers.get("accept")).toBe(ALLEGRO_ACCEPT);
    expect(listing?.headers.get("authorization")).toBe("Bearer test-token");
    const listingUrl = new URL(listing?.url ?? ALLEGRO_LISTING_URL);
    expect(listingUrl.searchParams.get("phrase")).toBe("1K0615301");
    expect(listingUrl.searchParams.get("fallback")).toBe("false");

    const again = await source.searchByOem("1K0615301");
    expect(again.ok && again.offers).toHaveLength(2);
    expect(calls.filter((call) => call.url === ALLEGRO_TOKEN_URL)).toHaveLength(1);
    expect(lines).toEqual([]);
    expect(await source.searchByOem(" - . ")).toEqual({ ok: true, offers: [] });
  });

  it("403 a captcha počítá, HTML nečte a po prahu přestane volat", async () => {
    const lines: string[] = [];
    const blocked = scriptedFetch({
      token: { status: 200, body: fixture("token.json"), headers: { "content-type": "application/json" } },
      listing: {
        status: 403,
        body: fixture("listing-used.json"),
        headers: { "content-type": "application/json" },
      },
    });
    const source = createAllegroSource({
      env: {
        ALLEGRO_CLIENT_ID: "client",
        ALLEGRO_CLIENT_SECRET: "secret",
        SOURCE_BLOCK_THRESHOLD: "1",
      },
      fetchImpl: blocked.fetchImpl,
      log: (message) => lines.push(message),
    });
    expect(await source.searchByOem("1K0615301")).toMatchObject({ ok: false, error: "http-403", retryable: true });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("neobcházíme");
    expect((await source.health()).ok).toBe(false);
    const after = blocked.calls.length;
    expect(await source.searchByOem("1K0615301")).toEqual({ ok: true, offers: [] });
    expect(blocked.calls).toHaveLength(after);

    const captcha = scriptedFetch({
      token: { status: 200, body: fixture("token.json"), headers: { "content-type": "application/json" } },
      listing: { status: 200, body: fixture("captcha.html"), headers: { "content-type": "text/html" } },
    });
    const captchaLog: string[] = [];
    const captchaSource = createAllegroSource({
      env: {
        ALLEGRO_CLIENT_ID: "client",
        ALLEGRO_CLIENT_SECRET: "secret",
        SOURCE_BLOCK_THRESHOLD: "1",
      },
      fetchImpl: captcha.fetchImpl,
      log: (message) => captchaLog.push(message),
    });
    expect(await captchaSource.searchByOem("1K0615301")).toMatchObject({ ok: false, error: "captcha" });
    expect(captchaLog[0]).toContain("captcha");
    expect((await captchaSource.health()).detail).toContain("403 nebo captcha");
  });

  it("přesměrování nesleduje a rozbitý JSON nespadne", async () => {
    const redirected = scriptedFetch({
      token: { status: 302, body: "", headers: { location: "https://evil.example/login" } },
    });
    const source = createAllegroSource({
      env: { ALLEGRO_CLIENT_ID: "client", ALLEGRO_CLIENT_SECRET: "secret" },
      fetchImpl: redirected.fetchImpl,
    });
    expect(await source.searchByOem("1K0615301")).toMatchObject({ ok: false, error: "přesměrování, nepokračujeme" });
    expect(redirected.calls).toHaveLength(1);
    expect((await source.health()).ok).toBe(true);

    const broken = scriptedFetch({
      token: { status: 200, body: fixture("token.json"), headers: { "content-type": "application/json" } },
      listing: { status: 200, body: "{", headers: { "content-type": "application/json" } },
    });
    const brokenSource = createAllegroSource({
      env: { ALLEGRO_CLIENT_ID: "client", ALLEGRO_CLIENT_SECRET: "secret" },
      fetchImpl: broken.fetchImpl,
    });
    expect(await brokenSource.searchByOem("1K0615301")).toMatchObject({ ok: false, error: "rozbitý JSON výpisu" });
  });

  it("bez fetchImpl na ostré API nesáhne", async () => {
    const source = createAllegroSource({
      env: { ALLEGRO_CLIENT_ID: "client", ALLEGRO_CLIENT_SECRET: "secret" },
    });
    expect((await source.health()).detail).toContain("ostré API se nevolá");
    expect(await source.searchByOem("1K0615301")).toEqual({ ok: true, offers: [] });
  });

  it("500, 429, 401 a timeout jsou chyba, ne prázdný ceník", async () => {
    const env = { ALLEGRO_CLIENT_ID: "client", ALLEGRO_CLIENT_SECRET: "secret" };
    const tokenPage = { status: 200, body: fixture("token.json"), headers: { "content-type": "application/json" } };

    const serverError = scriptedFetch({
      token: tokenPage,
      listing: { status: 500, body: "{}", headers: { "content-type": "application/json" } },
    });
    expect(await createAllegroSource({ env, fetchImpl: serverError.fetchImpl }).searchByOem("1K0615301")).toMatchObject({
      ok: false,
      error: "http-500",
      retryable: true,
    });

    const limited = scriptedFetch({
      token: tokenPage,
      listing: { status: 429, body: "{}", headers: { "content-type": "application/json", "retry-after": "12" } },
    });
    expect(await createAllegroSource({ env, fetchImpl: limited.fetchImpl }).searchByOem("1K0615301")).toMatchObject({
      ok: false,
      error: "http-429",
      retryAfterSeconds: 12,
    });

    let tokens = 0;
    const unauthorized: typeof fetch = async (input) => {
      const url = String(input);
      if (url === ALLEGRO_TOKEN_URL) {
        tokens += 1;
        return new Response(fixture("token.json"), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("{}", { status: 401, headers: { "content-type": "application/json" } });
    };
    expect(await createAllegroSource({ env, fetchImpl: unauthorized }).searchByOem("1K0615301")).toMatchObject({
      ok: false,
      error: "http-401",
    });
    expect(tokens).toBe(2);

    const timedOut: typeof fetch = async (_input, init) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    };
    expect(await createAllegroSource({ env, fetchImpl: timedOut }).searchByOem("1K0615301")).toMatchObject({
      ok: false,
      error: "timeout",
    });

    const offline: typeof fetch = async () => {
      throw new TypeError("fetch failed");
    };
    expect(await createAllegroSource({ env, fetchImpl: offline }).searchByOem("1K0615301")).toMatchObject({
      ok: false,
      error: "síť zdroje selhala",
    });
  });

  it("pošle původní i kompaktní OEM", async () => {
    const { calls, fetchImpl } = scriptedFetch(happyPages());
    const source = createAllegroSource({
      env: { ALLEGRO_CLIENT_ID: "client", ALLEGRO_CLIENT_SECRET: "secret" },
      fetchImpl,
      now: () => new Date(fetchedAt),
    });
    const found = await source.searchByOem("1K0 615 301");
    expect(found.ok).toBe(true);
    const phrases = calls
      .map((call) => new URL(call.url))
      .filter((url) => url.origin + url.pathname === ALLEGRO_LISTING_URL && !url.searchParams.has("parameter.11323"))
      .map((url) => url.searchParams.get("phrase"));
    expect(phrases).toEqual(["1K0 615 301", "1K0615301"]);
  });

  it("strop těla platí s content-length i u streamu", async () => {
    const env = { ALLEGRO_CLIENT_ID: "client", ALLEGRO_CLIENT_SECRET: "secret" };
    const declared: typeof fetch = async () =>
      new Response("{}", { status: 200, headers: { "content-type": "application/json", "content-length": "99999" } });
    expect(
      await createAllegroSource({ env, fetchImpl: declared, bodyLimitBytes: 10 }).searchByOem("1K0615301"),
    ).toMatchObject({ ok: false, error: "odpověď je větší než limit" });

    const streamed: typeof fetch = async () => {
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("x".repeat(40)));
          controller.close();
        },
      });
      return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
    };
    expect(
      await createAllegroSource({ env, fetchImpl: streamed, bodyLimitBytes: 10 }).searchByOem("1K0615301"),
    ).toMatchObject({ ok: false, error: "odpověď je větší než limit" });
  });

  it("token bere jedním letem i při dvou hledáních najednou", async () => {
    let tokens = 0;
    let release: (response: Response) => void = () => {};
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url === ALLEGRO_TOKEN_URL) {
        tokens += 1;
        return pending;
      }
      return new Response(fixture("listing-filters.json"), {
        status: 200,
        headers: { "content-type": "application/vnd.allegro.public.v1+json" },
      });
    };
    const source = createAllegroSource({
      env: { ALLEGRO_CLIENT_ID: "client", ALLEGRO_CLIENT_SECRET: "secret" },
      fetchImpl,
      now: () => new Date(fetchedAt),
    });
    const first = source.searchByOem("1K0615301");
    const second = source.searchByOem("1K0615301");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(tokens).toBe(1);
    release(new Response(fixture("token.json"), { status: 200, headers: { "content-type": "application/json" } }));
    await Promise.all([first, second]);
  });

  it("špatné client credentials jsou trvalá chyba a zpráva neobsahuje tajemství", async () => {
    const lines: string[] = [];
    const fetchImpl: typeof fetch = async () =>
      new Response('{"error":"invalid_client"}', { status: 401, headers: { "content-type": "application/json" } });
    const result = await createAllegroSource({
      env: { ALLEGRO_CLIENT_ID: "client", ALLEGRO_CLIENT_SECRET: "tajne-heslo" },
      fetchImpl,
      log: (message) => lines.push(message),
    }).searchByOem("1K0615301");
    expect(result).toEqual({ ok: false, error: "neplatné přihlašovací údaje", retryable: false });
    expect(lines.join(" ")).toContain("client credentials");
    expect(lines.join(" ")).not.toContain("tajne-heslo");
  });
});
