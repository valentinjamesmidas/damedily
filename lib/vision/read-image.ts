const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export type VisionImage = {
  mediaType: "image/jpeg" | "image/png";
  data: string;
};

function jsonError(status: number, message: string): Response {
  return Response.json({ ok: false, message }, { status });
}

export async function readVisionImage(request: Request): Promise<VisionImage | Response> {
  let mediaType: string | null = null;
  let data: string | null = null;
  const contentType = request.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("application/json")) {
      const body = (await request.json()) as Record<string, unknown>;
      if (typeof body.mediaType === "string") mediaType = body.mediaType;
      if (typeof body.data === "string") data = body.data;
    } else if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("photo");
      if (file instanceof File) {
        if (file.size > MAX_IMAGE_BYTES) return jsonError(413, "Fotka je větší než 5 MB.");
        mediaType = file.type;
        data = Buffer.from(await file.arrayBuffer()).toString("base64");
      }
    } else {
      return jsonError(400, "Pošlete fotku jako JPEG nebo PNG.");
    }
  } catch {
    return jsonError(400, "Fotku se nepodařilo přečíst.");
  }

  if ((mediaType !== "image/jpeg" && mediaType !== "image/png") || !data) {
    return jsonError(400, "Pošlete fotku jako JPEG nebo PNG. WebP uložíte ve skladu, předvyplnění ho nečte.");
  }

  const cleaned = data.replace(/^data:image\/(?:jpeg|png);base64,/i, "").replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/]+=*$/.test(cleaned)) return jsonError(400, "Fotka není platné base64.");
  const bytes = Buffer.from(cleaned, "base64").byteLength;
  if (bytes <= 0 || bytes > MAX_IMAGE_BYTES) return jsonError(413, "Fotka je větší než 5 MB.");
  return { mediaType, data: cleaned };
}
