import { createHmac, timingSafeEqual } from "node:crypto";

import type { SearchQueryType } from "@/lib/search/types";
import { serializePublicOffer, type PublicOffer } from "@/lib/white-label";

export type SessionDraft = {
  userId: string | null;
  queryType: SearchQueryType;
  rawQuery: string;
  resolvedOem: string | null;
};

export type SessionStatus = "first_found" | "searching_alternatives" | "completed";

export type SessionPatch = {
  status: SessionStatus;
  results: readonly PublicOffer[];
};

export interface SearchSessionRecorder {
  save(draft: SessionDraft, patch: SessionPatch): Promise<void>;
}

export function publicSessionResults(results: readonly PublicOffer[]): PublicOffer[] {
  return results.map((offer) => JSON.parse(serializePublicOffer(offer)) as PublicOffer);
}

export function createMemorySessionRecorder(): SearchSessionRecorder & {
  statuses: SessionStatus[];
  results: PublicOffer[][];
} {
  const statuses: SessionStatus[] = [];
  const results: PublicOffer[][] = [];
  return {
    statuses,
    results,
    async save(_draft, patch) {
      statuses.push(patch.status);
      results.push(publicSessionResults(patch.results));
    },
  };
}

/**
 * Ověřený subjekt z access tokenu. Neověřené nebo cizí `userId` z těla požadavku se nebere.
 */
export function userIdFromAuthorization(header: string | null, secret: string | undefined): string | null {
  if (!header || !secret) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  const token = match?.[1];
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [encodedHeader, encodedPayload, signature] = parts;
  if (!encodedHeader || !encodedPayload || !signature) return null;

  const expected = createHmac("sha256", secret).update(`${encodedHeader}.${encodedPayload}`).digest("base64url");
  const actual = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as {
      sub?: unknown;
      role?: unknown;
      exp?: unknown;
    };
    if (payload.role !== "authenticated" || typeof payload.sub !== "string") return null;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.sub)) return null;
    if (typeof payload.exp === "number" && payload.exp * 1000 <= Date.now()) return null;
    return payload.sub;
  } catch {
    return null;
  }
}

export function createSupabaseSessionRecorder(
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch = fetch,
): SearchSessionRecorder {
  const url = (env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  const key = env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  let id: string | null = null;

  return {
    async save(draft, patch) {
      if (!url || !key) return;
      const results = publicSessionResults(patch.results);
      const headers = {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        Prefer: "return=representation",
      };
      if (!id) {
        const response = await fetchImpl(`${url}/rest/v1/search_sessions`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            user_id: draft.userId,
            query_type: draft.queryType,
            raw_query: draft.rawQuery,
            resolved_oem: draft.resolvedOem,
            status: patch.status,
            results,
          }),
          signal: AbortSignal.timeout(4_000),
        });
        if (!response.ok) return;
        const created: unknown = await response.json();
        const row = Array.isArray(created) ? created[0] : created;
        if (row && typeof row === "object" && "id" in row && typeof row.id === "string") id = row.id;
        return;
      }

      await fetchImpl(`${url}/rest/v1/search_sessions?id=eq.${id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ status: patch.status, results }),
        signal: AbortSignal.timeout(4_000),
      });
    },
  };
}
