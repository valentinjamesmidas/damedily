import { randomBytes } from "node:crypto";

type StoredImage = { url: string; exp: number };

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host.includes(":")) {
    const bare = host.replace(/^\[|\]$/g, "");
    return bare === "::1" || bare.startsWith("fc") || bare.startsWith("fd") || bare.startsWith("fe80:");
  }
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!ipv4) return false;
  const parts = ipv4.slice(1).map(Number);
  if (parts.some((part) => part > 255)) return true;
  const [a, b] = parts;
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

export function isPublicImageUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  return !isPrivateHostname(url.hostname);
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
 * Při blokaci zdroje vrátí chybu a požadavek neopakuje.
 */
export async function proxyImage(
  token: string,
  store: ImageLinkStore,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const target = store.resolve(token);
  if (!target) return new Response(null, { status: 404 });

  let upstream: Response;
  try {
    upstream = await fetchImpl(target, {
      redirect: "follow",
      headers: { "User-Agent": MEDIA_USER_AGENT, Accept: "image/avif,image/webp,image/*,*/*;q=0.8" },
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    return new Response(null, { status: 502 });
  }

  const type = upstream.headers.get("content-type") ?? "";
  if (!upstream.ok || !type.toLowerCase().startsWith("image/")) {
    return new Response(null, { status: 502 });
  }
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": type,
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
