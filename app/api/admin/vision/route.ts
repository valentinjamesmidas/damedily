import { requireAdmin } from "@/lib/admin/session";
import { draftInventoryFromPhoto } from "@/lib/dilobot";
import { modelUnavailableMessage } from "@/lib/model-error";
import { readVisionImage } from "@/lib/vision/read-image";
import { createXaiClient } from "@/lib/xai-grok";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Předvyplnění skladové karty. Bez role admin se model nevolá. */
export async function POST(request: Request): Promise<Response> {
  const access = await requireAdmin();
  if (!access.ok) {
    return Response.json({ ok: false, message: access.message }, { status: access.status });
  }

  const image = await readVisionImage(request);
  if (image instanceof Response) return image;

  try {
    const draft = await draftInventoryFromPhoto(createXaiClient(), {
      kind: "base64",
      mediaType: image.mediaType,
      data: image.data,
    });
    return Response.json({ ok: true, ...draft });
  } catch (error) {
    const message = `${modelUnavailableMessage(error, "Předvyplnění z fotky")} Kartu vyplňte ručně.`;
    return Response.json({ ok: false, message }, { status: 503 });
  }
}
