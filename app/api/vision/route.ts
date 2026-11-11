import { extractPartFromPhoto, visionHintForPublic } from "@/lib/dilobot";
import { modelUnavailableMessage } from "@/lib/model-error";
import { readVisionImage } from "@/lib/vision/read-image";
import { createXaiClient } from "@/lib/xai-grok";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Veřejné čtení fotky. Ven jde jen OEM a typ dílu, ne jistota modelu. */
export async function POST(request: Request): Promise<Response> {
  const image = await readVisionImage(request);
  if (image instanceof Response) return image;

  try {
    const hint = visionHintForPublic(
      await extractPartFromPhoto(createXaiClient(), { kind: "base64", mediaType: image.mediaType, data: image.data }),
    );
    return Response.json({ ok: true, ...hint });
  } catch (error) {
    const message = `${modelUnavailableMessage(error, "Rozpoznání z fotky")} Zadejte OEM ručně.`;
    return Response.json({ ok: false, message }, { status: 503 });
  }
}
