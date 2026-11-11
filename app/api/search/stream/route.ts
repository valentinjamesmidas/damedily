import { userIdFromAuthorization } from "@/lib/search/sessions";
import { getSearchRuntime } from "@/lib/search/runtime";
import { handleSearchPost } from "@/lib/search/stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Progresivní hledání. Ve streamu jsou jen veřejné nabídky. */
export async function POST(request: Request): Promise<Response> {
  const userId = userIdFromAuthorization(request.headers.get("authorization"), process.env.SUPABASE_JWT_SECRET);
  return handleSearchPost(request, { ...getSearchRuntime(), userId });
}
