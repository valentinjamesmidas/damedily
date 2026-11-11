import { describe, expect, it } from "vitest";

import { ImageLinkStore, MEDIA_USER_AGENT, isPublicImageUrl, proxyImage } from "@/lib/search/images";

describe("proxy fotek", () => {
  it("pustí ven jen veřejné https a soukromé adresy ne", () => {
    expect(isPublicImageUrl("https://cdn.example/a.jpg")).toBe(true);
    expect(isPublicImageUrl("http://cdn.example/a.jpg")).toBe(false);
    expect(isPublicImageUrl("https://127.0.0.1/a.jpg")).toBe(false);
    expect(isPublicImageUrl("https://10.1.1.1/a.jpg")).toBe(false);
    expect(isPublicImageUrl("https://localhost/a.jpg")).toBe(false);
  });

  it("pošle bajty beze změny a při blokaci už to neopakuje", async () => {
    const store = new ImageLinkStore();
    const bytes = new Uint8Array([1, 2, 3, 255]);
    const path = store.publish("https://cdn.example/a.jpg");
    const token = path?.split("/").pop() ?? "";
    let calls = 0;
    const ok = await proxyImage(token, store, async (_input, init) => {
      calls += 1;
      expect(new Headers(init?.headers).get("user-agent")).toBe(MEDIA_USER_AGENT);
      return new Response(bytes, { status: 200, headers: { "content-type": "image/jpeg" } });
    });
    expect(Array.from(new Uint8Array(await ok.arrayBuffer()))).toEqual([1, 2, 3, 255]);
    expect(ok.headers.get("content-type")).toBe("image/jpeg");

    const blocked = await proxyImage(token, store, async () => {
      calls += 1;
      return new Response("no", { status: 403, headers: { "content-type": "text/html" } });
    });
    expect(blocked.status).toBe(502);
    expect(calls).toBe(2);
  });
});
