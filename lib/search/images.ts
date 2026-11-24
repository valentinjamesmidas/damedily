import { randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";

type StoredImage = { url: string; exp: number };

/** Nejvýš tři požadavky včetně původní adresy. Další přesměrování se zahodí. */
const MAX_IMAGE_HOPS = 3;

/** Stejný strop jako u fotek skladu. Větší tělo se nečte celé. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

export type DnsLookup = (hostname: string) => Promise<readonly string[]>;

function hostnameOf(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

function parseIpv4(value: string): [number, number, number, number] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (!match) return null;
  const parts = match.slice(1).map((part) => Number(part));
  if (parts.some((part) => part > 255)) return null;
  return parts as [number, number, number, number];
}

function ipv4Bits(a: number, b: number, c: number, d: number): number {
  return (((a << 24) | (b << 16) | (c << 8) | d) >>> 0);
}

function ipv4Blocked(parts: [number, number, number, number]): boolean {
  const value = ipv4Bits(parts[0], parts[1], parts[2], parts[3]);
  const ranges: Array<[number, number]> = [
    [ipv4Bits(127, 0, 0, 0), 8],
    [ipv4Bits(10, 0, 0, 0), 8],
    [ipv4Bits(172, 16, 0, 0), 12],
    [ipv4Bits(192, 168, 0, 0), 16],
    [ipv4Bits(169, 254, 0, 0), 16],
    [ipv4Bits(0, 0, 0, 0), 8],
    [ipv4Bits(100, 64, 0, 0), 10],
    [ipv4Bits(192, 0, 0, 0), 24],
    [ipv4Bits(198, 18, 0, 0), 15],
    [ipv4Bits(224, 0, 0, 0), 4],
    [ipv4Bits(240, 0, 0, 0), 4],
  ];
  return ranges.some(([base, bits]) => {
    const mask = (0xffffffff << (32 - bits)) >>> 0;
    return (value & mask) === (base & mask);
  });
}

function expandIpv6(input: string): number[] | null {
  let value = hostnameOf(input).replace(/%.*$/, "");
  if (value.includes(".")) {
    const last = value.lastIndexOf(":");
    const v4 = parseIpv4(value.slice(last + 1));
    if (!v4 || last < 0) return null;
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    value = `${value.slice(0, last)}:${hi}:${lo}`;
  }
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const groups = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  if (groups.length !== 8) return null;
  const numbers: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    numbers.push(Number.parseInt(group, 16));
  }
  return numbers;
}

function ipv4FromWords(hi: number, lo: number): [number, number, number, number] {
  return [(hi >> 8) & 255, hi & 255, (lo >> 8) & 255, lo & 255];
}

function mappedIpv4(groups: number[]): [number, number, number, number] | null {
  const prefix = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  if (!prefix) return null;
  return ipv4FromWords(groups[6] ?? 0, groups[7] ?? 0);
}

function compatibleIpv4(groups: number[]): [number, number, number, number] | null {
  if (!groups.slice(0, 6).every((group) => group === 0)) return null;
  return ipv4FromWords(groups[6] ?? 0, groups[7] ?? 0);
}

function nat64Ipv4(groups: number[]): [number, number, number, number] | null {
  const prefix = groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every((group) => group === 0);
  if (!prefix) return null;
  return ipv4FromWords(groups[6] ?? 0, groups[7] ?? 0);
}

function sixToFourIpv4(groups: number[]): [number, number, number, number] | null {
  if (groups[0] !== 0x2002) return null;
  return ipv4FromWords(groups[1] ?? 0, groups[2] ?? 0);
}

/** Soukromé, link-local, CGNAT a loopback adresy, včetně IPv4 schovaného v ::ffff:. */
export function isBlockedAddress(value: string): boolean {
  const bare = hostnameOf(value).replace(/%.*$/, "");
  const v4 = parseIpv4(bare);
  if (v4) return ipv4Blocked(v4);
  const groups = expandIpv6(bare);
  if (!groups) return false;
  if (groups.every((group) => group === 0)) return true;
  const embedded = mappedIpv4(groups) ?? compatibleIpv4(groups) ?? nat64Ipv4(groups) ?? sixToFourIpv4(groups);
  if (embedded) return ipv4Blocked(embedded);
  if (groups.every((group, index) => group === (index === 7 ? 1 : 0))) return true;
  if ((groups[0]! & 0xfe00) === 0xfc00) return true;
  if ((groups[0]! & 0xffc0) === 0xfe80) return true;
  if ((groups[0]! & 0xffc0) === 0xfec0) return true;
  if ((groups[0]! & 0xff00) === 0xff00) return true;
  if (groups[0] === 0x2001 && groups[1] === 0x0db8) return true;
  if (groups[0] === 0x0100 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0) return true;
  return false;
}

function isLocalName(hostname: string): boolean {
  const host = hostnameOf(hostname);
  return host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local");
}

export function isPublicImageUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  if (url.port !== "" && url.port !== "443") return false;
  const host = hostnameOf(url.hostname);
  return Boolean(host) && !isLocalName(host) && !isBlockedAddress(host);
}

async function lookupAll(hostname: string): Promise<readonly string[]> {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

async function approvedImageUrl(
  value: string,
  resolveDns: DnsLookup,
): Promise<{ url: URL; pinnedAddress: string; family: number } | null> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const port = url.port === "" ? (url.protocol === "https:" ? 443 : 80) : Number(url.port);
  if (port !== 80 && port !== 443) return null;
  const host = hostnameOf(url.hostname);
  if (!host || isLocalName(host) || isBlockedAddress(host)) return null;
  let addresses: readonly string[];
  try {
    addresses = await resolveDns(host);
  } catch {
    return null;
  }
  const pinnedAddress = addresses[0];
  if (!pinnedAddress || addresses.some((address) => isLocalName(address) || isBlockedAddress(address))) {
    return null;
  }
  return { url, pinnedAddress, family: pinnedAddress.includes(":") ? 6 : 4 };
}

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"]);

function imageContentType(header: string | null): string | null {
  if (!header) return null;
  const mime = header.split(";")[0]?.trim().toLowerCase() ?? "";
  return ALLOWED_IMAGE_TYPES.has(mime) ? mime : null;
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | { address: string; family: number }[], family?: number) => void;

/** Lookup, který ignoruje pozdější DNS a vrací už ověřenou adresu. */
export function lookupPinned(address: string, family: number) {
  return (_hostname: string, options: unknown, callback?: LookupCallback) => {
    const done = typeof options === "function" ? (options as LookupCallback) : callback;
    if (!done) return;
    const all = typeof options === "object" && options !== null && "all" in options && (options as { all?: boolean }).all === true;
    if (all) {
      done(null, [{ address, family }]);
      return;
    }
    done(null, address, family);
  };
}

export type ImageTransport = (input: {
  url: URL;
  pinnedAddress: string;
  family: number;
  headers: Record<string, string>;
  signal: AbortSignal;
}) => Promise<Response>;

const PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360" role="img" aria-label="Zástupná fotka dílu"><rect width="640" height="360" fill="#1E293B"/><circle cx="320" cy="168" r="46" fill="none" stroke="#FF5A1F" stroke-width="10"/><path d="M320 122v92M274 168h92" stroke="#F8FAFC" stroke-width="8"/><text x="320" y="268" text-anchor="middle" fill="#F8FAFC" font-family="sans-serif" font-size="28">Fotka dílu</text></svg>`;

export function placeholderImageResponse(): Response {
  return new Response(PLACEHOLDER_SVG, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Disposition": "inline",
    },
  });
}

/**
 * Připnutí DNS nejde na Cloudflare Workers. `process.versions.node` tam při
 * nodejs_compat existuje, proto se na něj nespoléhá. Vypne ho příznak
 * IMAGE_PROXY_PIN_DNS=0 nebo user agent přesně `Cloudflare-Workers`.
 */
export function canPinDns(input?: {
  env?: Record<string, string | undefined>;
  userAgent?: string;
}): boolean {
  const env = input?.env ?? (typeof process === "undefined" ? {} : process.env);
  if (env.IMAGE_PROXY_PIN_DNS === "0") return false;
  const userAgent =
    input?.userAgent ?? (typeof navigator === "undefined" ? "" : navigator.userAgent);
  return userAgent !== "Cloudflare-Workers";
}

/**
 * Node umí připnout socket na ověřenou IP a nechat Host i SNI na jméně.
 * Cloudflare Workers `fetch` to neumí. Tam se cizí fotka nestahuje a vrací se zástupný obrázek.
 */
export function nodePinnedTransport(input: {
  url: URL;
  pinnedAddress: string;
  family: number;
  headers: Record<string, string>;
  signal: AbortSignal;
}): Promise<Response> {
  if (!canPinDns()) return Promise.resolve(placeholderImageResponse());
  const lib = input.url.protocol === "https:" ? https : http;
  return new Promise((resolve) => {
    const req = lib.request(
      {
        protocol: input.url.protocol,
        hostname: input.url.hostname,
        port: input.url.port === "" ? undefined : Number(input.url.port),
        path: `${input.url.pathname}${input.url.search}`,
        method: "GET",
        headers: input.headers,
        servername: input.url.hostname,
        lookup: lookupPinned(input.pinnedAddress, input.family),
        signal: input.signal,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let total = 0;
        let rejected = false;
        res.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > MAX_IMAGE_BYTES) {
            rejected = true;
            req.destroy();
            resolve(new Response(null, { status: 502 }));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          if (rejected) return;
          const body = Buffer.concat(chunks);
          const headers = new Headers();
          for (const [key, value] of Object.entries(res.headers)) {
            if (typeof value === "string") headers.set(key, value);
            else if (Array.isArray(value) && value.length > 0) headers.set(key, value.join(", "));
          }
          const bytes = new ArrayBuffer(body.byteLength);
          new Uint8Array(bytes).set(body);
          resolve(new Response(bytes, { status: res.statusCode ?? 502, headers }));
        });
      },
    );
    req.on("error", () => resolve(new Response(null, { status: 502 })));
    req.end();
  });
}

async function readLimited(response: Response, maxBytes: number): Promise<Uint8Array | null> {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    if (!/^\d+$/.test(declared) || Number(declared) > maxBytes) return null;
  }
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/**
 * Veřejná cesta fotky neobsahuje adresu zdroje.
 * Samotné bajty se při stažení nemění.
 *
 * TODO(workers): Map v paměti procesu na Cloudflare Workers nepřežije izolát.
 * Odkaz má žít v KV nebo v podepsaném tokenu.
 */
export class ImageLinkStore {
  private readonly links = new Map<string, StoredImage>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs = 6 * 60 * 60 * 1000,
  ) {}

  publish(url: string): string | null {
    if (!isPublicImageUrl(url)) return null;
    const id = randomBytes(16).toString("base64url");
    this.links.set(id, { url, exp: this.now() + this.ttlMs });
    return `/api/media/${id}`;
  }

  resolve(token: string): string | null {
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
    const stored = this.links.get(token);
    if (!stored) return null;
    if (stored.exp <= this.now()) {
      this.links.delete(token);
      return null;
    }
    return stored.url;
  }
}

const globalImages = globalThis as typeof globalThis & { __damedilyImages?: ImageLinkStore };

export function getImageLinkStore(): ImageLinkStore {
  globalImages.__damedilyImages ??= new ImageLinkStore();
  return globalImages.__damedilyImages;
}

export const MEDIA_USER_AGENT = "DamedilySearch/0.1 (+https://damedily.cz; image proxy)";

/**
 * Přepošle fotku tak, jak přišla. Nemění rozměr, ořez ani vodoznak.
 * Každý skok se znovu ověří. Přesměrování na soukromou adresu ani cizí typ se nevrací.
 */
export async function proxyImage(
  token: string,
  store: ImageLinkStore,
  fetchImpl?: typeof fetch,
  resolveDns: DnsLookup = lookupAll,
  transport: ImageTransport = nodePinnedTransport,
): Promise<Response> {
  const initial = store.resolve(token);
  if (!initial) return new Response(null, { status: 404 });
  if (!canPinDns()) return placeholderImageResponse();
  const headers = { "User-Agent": MEDIA_USER_AGENT, Accept: "image/avif,image/webp,image/jpeg,image/png,image/gif" };

  let current = initial;
  for (let hop = 1; hop <= MAX_IMAGE_HOPS; hop += 1) {
    const target = await approvedImageUrl(current, resolveDns);
    if (!target) return new Response(null, { status: 502 });

    let upstream: Response;
    try {
      const signal = AbortSignal.timeout(8_000);
      upstream = fetchImpl
        ? await fetchImpl(target.url, { redirect: "manual", headers, signal })
        : await transport({ ...target, headers, signal });
    } catch {
      return new Response(null, { status: 502 });
    }

    if (REDIRECT_STATUS.has(upstream.status)) {
      const location = upstream.headers.get("location");
      if (!location || hop === MAX_IMAGE_HOPS) return new Response(null, { status: 502 });
      try {
        current = new URL(location, target.url).href;
      } catch {
        return new Response(null, { status: 502 });
      }
      continue;
    }

    const type = imageContentType(upstream.headers.get("content-type"));
    if (!upstream.ok || !type) return new Response(null, { status: 502 });
    const body = await readLimited(upstream, MAX_IMAGE_BYTES);
    if (!body) return new Response(null, { status: 502 });
    const bytes = new ArrayBuffer(body.byteLength);
    new Uint8Array(bytes).set(body);
    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": type,
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Content-Disposition": "inline",
      },
    });
  }

  return new Response(null, { status: 502 });
}
