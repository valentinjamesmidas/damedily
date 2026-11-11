import { getImageLinkStore, proxyImage } from "@/lib/search/images";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string }> };

/** Přeposílá fotku beze změny. Vodoznak ani ořez se neodstraňuje. */
export async function GET(_request: Request, context: Params): Promise<Response> {
  const { token } = await context.params;
  return proxyImage(token, getImageLinkStore());
}
