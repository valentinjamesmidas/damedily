import { randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";

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

function mappedIpv4(groups: number[]): [number, number, number, number] | null {
  const prefix = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  if (!prefix) return null;
  const hi = groups[6] ?? 0;
  const lo = groups[7] ?? 0;
  return [(hi >> 8) & 255, hi & 255, (lo >> 8) & 255, lo & 255];
}

/** Soukromé, link-local, CGNAT a loopback adresy, včetně IPv4 schovaného v ::ffff:. */
export function isBlockedAddress(value: string): boolean {
  const bare = hostnameOf(value).replace(/%.*$/, "");
  const v4 = parseIpv4(bare);
  if (v4) return ipv4Blocked(v4);
  const groups = expandIpv6(bare);
  if (!groups) return false;
  const mapped = mappedIpv4(groups);
  if (mapped) return ipv4Blocked(mapped);
  if (groups.every((group, index) => group === (index === 7 ? 1 : 0))) return true;
  if ((groups[0]! & 0xfe00) === 0xfc00) return true;
  if ((groups[0]! & 0xffc0) === 0xfe80) return true;
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

async function approvedImageUrl(value: string, resolveDns: DnsLookup): Promise<URL | null> {
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
  if (addresses.length === 0 || addresses.some((address) => isLocalName(address) || isBlockedAddress(address))) {
    return null;
  }
  return url;
}

function imageContentType(header: string | null): string | null {
  if (!header) return null;
  const type = header.trim();
  return type.toLowerCase().startsWith("image/") ? type : null;
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
  fetchImpl: typeof fetch = fetch,
  resolveDns: DnsLookup = lookupAll,
): Promise<Response> {
  const initial = store.resolve(token);
  if (!initial) return new Response(null, { status: 404 });

  let current = initial;
  for (let hop = 1; hop <= MAX_IMAGE_HOPS; hop += 1) {
    const target = await approvedImageUrl(current, resolveDns);
    if (!target) return new Response(null, { status: 502 });

    let upstream: Response;
    try {
      upstream = await fetchImpl(target, {
        redirect: "manual",
        headers: { "User-Agent": MEDIA_USER_AGENT, Accept: "image/avif,image/webp,image/*,*/*;q=0.8" },
        signal: AbortSignal.timeout(8_000),
      });
    } catch {
      return new Response(null, { status: 502 });
    }

    if (REDIRECT_STATUS.has(upstream.status)) {
      const location = upstream.headers.get("location");
      if (!location || hop === MAX_IMAGE_HOPS) return new Response(null, { status: 502 });
      try {
        current = new URL(location, target).href;
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
      },
    });
  }

  return new Response(null, { status: 502 });
}
