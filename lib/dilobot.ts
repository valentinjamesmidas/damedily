import {
  dilobotTurnSchema,
  listingNormalizationSchema,
  publicHintFromVision,
  visionExtractionSchema,
  type DilobotTurn,
  type ListingNormalization,
  type PublicVisionHint,
  type VisionExtraction,
} from "@/lib/ai-schemas";
import { DILOBOT_JSON_HINT, DILOBOT_SYSTEM_PROMPT } from "@/lib/prompts/dilobot";
import { LISTING_SYSTEM_PROMPT } from "@/lib/prompts/listing";
import { VISION_SYSTEM_PROMPT } from "@/lib/prompts/vision";
import {
  userImageMessage,
  type XaiClient,
  type XaiImageSource,
  type XaiMessage,
} from "@/lib/xai-grok";

const MAX_MESSAGES = 12;
const MAX_CONTENT_LENGTH = 2_000;

export type DilobotHistoryTurn = {
  role: "user" | "assistant";
  content: string;
};

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  "X-Content-Type-Options": "nosniff",
};

function jsonError(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

function sse(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export function buildDilobotMessages(history: readonly DilobotHistoryTurn[]): XaiMessage[] {
  const questionsAsked = history
    .filter((turn) => turn.role === "assistant")
    .reduce((sum, turn) => sum + (turn.content.match(/\?/g)?.length ?? 0), 0);

  const messages: XaiMessage[] = [{ role: "system", content: DILOBOT_SYSTEM_PROMPT }];
  if (questionsAsked >= 3) {
    messages.push({
      role: "system",
      content:
        "V téhle konverzaci už byly tři upřesňující otázky. Další otázku nepokládej. Shrň, co je známé, a co ještě chybí.",
    });
  }
  for (const turn of history) {
    messages.push({ role: turn.role, content: turn.content });
  }
  return messages;
}

export function parseDilobotHistory(payload: unknown): DilobotHistoryTurn[] | Response {
  if (!payload || typeof payload !== "object" || !("messages" in payload)) {
    return jsonError(400, "Chybí pole messages.");
  }
  const messages = payload.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return jsonError(400, "Konverzace musí obsahovat aspoň jednu zprávu.");
  }
  if (messages.length > MAX_MESSAGES) {
    return jsonError(400, "Konverzace je příliš dlouhá.");
  }

  const history: DilobotHistoryTurn[] = [];
  for (const message of messages) {
    if (!message || typeof message !== "object" || !("role" in message) || !("content" in message)) {
      return jsonError(400, "Každá zpráva musí mít role a content.");
    }
    const role = message.role;
    const content = message.content;
    if (role !== "user" && role !== "assistant") {
      return jsonError(400, "Povolená je jen role user nebo assistant.");
    }
    if (typeof content !== "string") {
      return jsonError(400, "Obsah zprávy musí být text.");
    }
    const trimmed = content.trim();
    if (!trimmed) {
      return jsonError(400, "Zpráva je prázdná.");
    }
    if (trimmed.length > MAX_CONTENT_LENGTH) {
      return jsonError(400, "Zpráva je příliš dlouhá.");
    }
    history.push({ role, content: trimmed });
  }

  if (history[0]?.role !== "user") {
    return jsonError(400, "Konverzace musí začínat zprávou zákazníka.");
  }
  return history;
}

/**
 * Tenká vrstva nad klientem. Streamuje jen text pro zákazníka, ne uvažování modelu.
 * Hledání u dodavatelů sem nepatří.
 */
export async function handleDilobotPost(request: Request, client: XaiClient): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonError(400, "Tělo požadavku musí být JSON.");
  }

  const history = parseDilobotHistory(payload);
  if (history instanceof Response) return history;

  try {
    client.ensureConfigured();
  } catch {
    return jsonError(503, "Dílobot teď není dostupný.");
  }

  const messages = buildDilobotMessages(history);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of client.chatStream({ messages, purpose: "text", signal: request.signal })) {
          if (event.type === "text" && event.text) {
            controller.enqueue(encoder.encode(sse({ type: "text", text: event.text })));
          } else if (event.type === "done") {
            controller.enqueue(encoder.encode(sse({ type: "done" })));
          }
        }
        controller.close();
      } catch {
        try {
          controller.enqueue(
            encoder.encode(sse({ type: "error", message: "Dílobot teď neodpověděl. Zkuste to znovu." })),
          );
          controller.close();
        } catch {
          // Klient už stream neposlouchá.
        }
      }
    },
  });

  return new Response(stream, { status: 200, headers: SSE_HEADERS });
}

export async function completeDilobotTurn(
  client: XaiClient,
  history: readonly DilobotHistoryTurn[],
): Promise<DilobotTurn> {
  const messages = buildDilobotMessages(history);
  messages.push({ role: "system", content: DILOBOT_JSON_HINT });
  return client.chatJson({
    messages,
    purpose: "text",
    schema: dilobotTurnSchema,
    schemaName: "dilobot_turn",
  });
}

export async function normalizeListing(client: XaiClient, sourceText: string): Promise<ListingNormalization> {
  const text = sourceText.trim();
  if (!text) {
    throw new TypeError("Zdrojový inzerát je prázdný.");
  }
  return client.chatJson({
    purpose: "text",
    schema: listingNormalizationSchema,
    schemaName: "listing_normalization",
    messages: [
      { role: "system", content: LISTING_SYSTEM_PROMPT },
      { role: "user", content: text },
    ],
  });
}

export async function extractPartFromPhoto(
  client: XaiClient,
  image: XaiImageSource,
  note = "Přečti OEM a typ dílu.",
): Promise<VisionExtraction> {
  return client.chatJson({
    purpose: "vision",
    schema: visionExtractionSchema,
    schemaName: "vision_extraction",
    messages: [{ role: "system", content: VISION_SYSTEM_PROMPT }, userImageMessage(image, note)],
  });
}

export function visionHintForPublic(result: VisionExtraction): PublicVisionHint {
  return publicHintFromVision(result);
}
