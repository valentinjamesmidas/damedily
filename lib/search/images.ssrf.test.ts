import { describe, expect, it } from "vitest";

import { ImageLinkStore, isBlockedAddress, isPublicImageUrl, lookupPinned, proxyImage, type ImageTransport } from "@/lib/search/images";

const PUBLIC_IP = "93.184.216.34";
const IMAGE = new Uint8Array([1, 2, 3, 255]);

function imageResponse(): Response {
  return new Response(IMAGE, { status: 200, headers: { "content-type": "image/jpeg" } });
}

async function proxyStored(
  url: string,
  resolveDns: (hostname: string) => Promise<readonly string[]>,
  fetchImpl?: typeof fetch,
  transport?: ImageTransport,
): Promise<Response | null> {
  const store = new ImageLinkStore();
  const path = store.publish(url);
  if (!path) return null;
  const token = path.split("/").pop() ?? "";
  return proxyImage(token, store, fetchImpl, resolveDns, transport);
}

describe("proxy fotek proti SSRF", () => {
  it("odmítne literalní a DNS adresy z privátních rozsahů", async () => {
    expect(isPublicImageUrl("https://100.64.0.1/a.jpg")).toBe(false);
    expect(isPublicImageUrl("https://[::ffff:127.0.0.1]/a.jpg")).toBe(false);
    expect(isPublicImageUrl("https://169.254.169.254/latest")).toBe(false);
    expect(isPublicImageUrl("https://localhost/a.jpg")).toBe(false);
    expect(isPublicImageUrl("https://cdn.example:8080/a.jpg")).toBe(false);

    const blocked = [
      "127.0.0.1",
      "10.0.0.1",
      "172.16.0.1",
      "192.168.0.1",
      "169.254.169.254",
      "0.0.0.1",
      "100.64.0.1",
      "::1",
      "fc00::1",
      "fd00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "::ffff:10.0.0.1",
    ];
    for (const address of blocked) {
      const calls: string[] = [];
      const response = await proxyStored(
        "https://cdn.example/a.jpg",
        async () => [address],
        async (input) => {
          calls.push(String(input));
          return imageResponse();
        },
      );
      expect(response?.status, address).toBe(502);
      expect(calls, address).toEqual([]);
    }

    const mixed = await proxyStored(
      "https://cdn.example/a.jpg",
      async () => [PUBLIC_IP, "10.1.1.1"],
      async () => imageResponse(),
    );
    expect(mixed?.status).toBe(502);
  });

  it("odmítne přesměrování na vnitřní adresu a neobrázkový obsah", async () => {
    const calls: string[] = [];
    const redirected = await proxyStored(
      "https://cdn.example/start.jpg",
      async (hostname) => (hostname === "169.254.169.254" ? ["169.254.169.254"] : [PUBLIC_IP]),
      async (input, init) => {
        const url = String(input);
        calls.push(url);
        if (init?.redirect !== "manual") {
          return imageResponse();
        }
        if (url.startsWith("https://cdn.example/start.jpg")) {
          return new Response(null, {
            status: 302,
            headers: { location: "http://169.254.169.254/latest/meta-data" },
          });
        }
        return imageResponse();
      },
    );
    expect(redirected?.status).toBe(502);
    expect(calls.some((url) => url.includes("169.254.169.254"))).toBe(false);

    const html = await proxyStored(
      "https://cdn.example/a.jpg",
      async () => [PUBLIC_IP],
      async () => new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } }),
    );
    expect(html?.status).toBe(502);
  });

  it("veřejný obrázek na 80/443 propustí a velikost i počet skoků hlídá", async () => {
    const ok = await proxyStored(
      "https://cdn.example/a.jpg",
      async () => [PUBLIC_IP],
      async () => imageResponse(),
    );
    expect(ok?.status).toBe(200);
    expect(Array.from(new Uint8Array(await ok!.arrayBuffer()))).toEqual([1, 2, 3, 255]);
    expect(ok?.headers.get("content-type")).toBe("image/jpeg");
    expect(ok?.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(ok?.headers.get("content-disposition")).toBe("inline");

    const svg = await proxyStored(
      "https://cdn.example/a.svg",
      async () => [PUBLIC_IP],
      async () => new Response("<svg></svg>", { status: 200, headers: { "content-type": "image/svg+xml" } }),
    );
    expect(svg?.status).toBe(502);

    const huge = await proxyStored(
      "https://cdn.example/a.jpg",
      async () => [PUBLIC_IP],
      async () => new Response(IMAGE, { status: 200, headers: { "content-type": "image/jpeg", "content-length": "6000000" } }),
    );
    expect(huge?.status).toBe(502);

    let hops = 0;
    const tooMany = await proxyStored(
      "https://cdn.example/hop-0.jpg",
      async () => [PUBLIC_IP],
      async (input, init) => {
        hops += 1;
        if (init?.redirect !== "manual") return imageResponse();
        const current = Number(/hop-(\d+)/.exec(String(input))?.[1] ?? "0");
        return new Response(null, {
          status: 302,
          headers: { location: `https://cdn.example/hop-${current + 1}.jpg` },
        });
      },
    );
    expect(tooMany?.status).toBe(502);
    expect(hops).toBeLessThanOrEqual(3);
  });

  it("blokuje další vyhrazené rozsahy", () => {
    const samples: Array<[string, string]> = [
      ["::/128", "::"],
      ["IPv4-compatible", "::7f00:1"],
      ["NAT64", "64:ff9b::7f00:1"],
      ["6to4", "2002:7f00:1::"],
      ["multicast", "224.0.0.1"],
      ["reserved", "240.0.0.1"],
      ["broadcast", "255.255.255.255"],
      ["benchmark", "198.18.0.1"],
      ["ietf", "192.0.0.1"],
    ];
    for (const [label, address] of samples) {
      expect(isBlockedAddress(address), label).toBe(true);
    }
  });

  it("druhé DNS na loopback nepřepíše už ověřenou adresu", async () => {
    let calls = 0;
    const response = await proxyStored(
      "https://cdn.example/pin.jpg",
      async () => {
        calls += 1;
        return calls === 1 ? [PUBLIC_IP] : ["127.0.0.1"];
      },
      undefined,
      async (input) => {
        const pinned = await new Promise<string>((resolve) => {
          lookupPinned(input.pinnedAddress, input.family)(input.url.hostname, {}, (_err, address) => {
            resolve(String(address));
          });
        });
        expect(input.pinnedAddress).toBe(PUBLIC_IP);
        expect(pinned).toBe(PUBLIC_IP);
        expect(pinned).not.toBe("127.0.0.1");
        return new Response(IMAGE, { status: 200, headers: { "content-type": "image/jpeg" } });
      },
    );
    expect(response?.status).toBe(200);
    expect(calls).toBe(1);
  });
});
