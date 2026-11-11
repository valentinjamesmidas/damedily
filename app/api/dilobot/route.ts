import { handleDilobotPost } from "@/lib/dilobot";
import { createXaiClient } from "@/lib/xai-grok";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Interní streaming Dílobota. Bez UI a bez hledání u dodavatelů. */
export async function POST(request: Request): Promise<Response> {
  return handleDilobotPost(request, createXaiClient());
}
