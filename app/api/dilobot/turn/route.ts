import { completeDilobotTurn, parseDilobotHistory } from "@/lib/dilobot";
import { modelUnavailableMessage } from "@/lib/model-error";
import { createXaiClient } from "@/lib/xai-grok";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Strukturovaný závěr konverzace. Text pro zákazníka streamuje /api/dilobot. */
export async function POST(request: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Tělo požadavku musí být JSON." }, { status: 400 });
  }

  const history = parseDilobotHistory(payload);
  if (history instanceof Response) return history;

  try {
    const turn = await completeDilobotTurn(createXaiClient(), history);
    return Response.json({
      readyForSearch: turn.readyForSearch,
      specification: turn.specification,
    });
  } catch (error) {
    return Response.json(
      { error: `${modelUnavailableMessage(error, "Dílobot")} Pokračujte v katalogu nebo zadejte OEM.` },
      { status: 503 },
    );
  }
}
