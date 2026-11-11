import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { createSupabaseSessionRecorder, publicSessionResults, userIdFromAuthorization } from "@/lib/search/sessions";
import { toPublicOffer, type OfferDraft } from "@/lib/white-label";

function token(secret: string, payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

describe("relace hledání", () => {
  it("vezme jen ověřený subjekt a do záznamu dá veřejnou nabídku", async () => {
    const secret = "test-secret";
    const userId = "11111111-1111-4111-8111-111111111111";
    const header = `Bearer ${token(secret, { sub: userId, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 60 })}`;
    expect(userIdFromAuthorization(header, secret)).toBe(userId);
    expect(userIdFromAuthorization(header, "jiny")).toBeNull();
    expect(userIdFromAuthorization(header, undefined)).toBeNull();

    const offer = toPublicOffer({
      titleCs: "Kotouč",
      condition: "pouzity",
      conditionDetail: "Použitý",
      originKind: "oem",
      sourcePlatform: "ovoko",
      costPriceCzk: 100,
      internalProjectTag: "damedily",
      aiScore: 0.4,
    } satisfies OfferDraft);
    expect(JSON.stringify(publicSessionResults([offer]))).not.toMatch(/ovoko|cost|aiScore/i);

    const bodies: unknown[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      const url = String(input);
      if (init?.method === "POST") return Response.json([{ id: "session-1" }]);
      expect(url).toContain("id=eq.session-1");
      return new Response(null, { status: 204 });
    };
    const recorder = createSupabaseSessionRecorder(
      { SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: "service-secret" },
      fetchImpl,
    );
    await recorder.save(
      { userId: null, queryType: "catalog", rawQuery: "1K0615301", resolvedOem: "1K0615301" },
      { status: "first_found", results: [offer] },
    );
    await recorder.save(
      { userId: null, queryType: "catalog", rawQuery: "1K0615301", resolvedOem: "1K0615301" },
      { status: "completed", results: [offer] },
    );
    expect(bodies[0]).toMatchObject({ user_id: null, status: "first_found" });
    expect(bodies[1]).toMatchObject({ status: "completed" });
    expect(JSON.stringify(bodies)).not.toContain("service-secret");
    expect(JSON.stringify(bodies).toLowerCase()).not.toContain("ovoko");
  });
});
