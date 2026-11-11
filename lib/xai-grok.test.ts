import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  XaiError,
  XaiSchemaError,
  createXaiClient,
  imageUrlFromSource,
  readXaiConfig,
  type XaiChatRequest,
  type XaiClientOptions,
} from "./xai-grok";

const API_KEY = "xai-test-secret-value";

type Captured = { url: string; init: RequestInit };

function completion(content: string | null, extra: Record<string, unknown> = {}) {
  return {
    id: "cmpl-1",
    object: "chat.completion",
    model: "grok-4.7",
    choices: [
      {
        index: 0,
        finish_reason: "stop",
        message: {
          role: "assistant",
          content,
          refusal: null,
          ...extra,
        },
      },
    ],
  };
}

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function streamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

function clientWith(fetchImpl: typeof fetch, overrides: XaiClientOptions = {}) {
  const captured: Captured[] = [];
  const sleeps: number[] = [];
  const wrapped: typeof fetch = async (input, init) => {
    captured.push({ url: String(input), init: init ?? {} });
    return fetchImpl(input, init);
  };
  const client = createXaiClient({
    env: {},
    apiKey: API_KEY,
    fetchImpl: wrapped,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    ...overrides,
  });
  return { client, captured, sleeps };
}

function bodyOf(captured: Captured): XaiChatRequest & Record<string, unknown> {
  return JSON.parse(String(captured.init.body)) as XaiChatRequest & Record<string, unknown>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("konfigurace modelu", () => {
  it("bere ID z prostředí a bez něj použije grok-4.7", () => {
    expect(readXaiConfig({}).textModel).toBe("grok-4.7");
    expect(readXaiConfig({}).visionModel).toBe("grok-4.7");
    expect(
      readXaiConfig({
        XAI_TEXT_MODEL: " text-model ",
        XAI_VISION_MODEL: " vision-model ",
        XAI_BASE_URL: "https://api.x.ai/v1/",
      }),
    ).toMatchObject({
      textModel: "text-model",
      visionModel: "vision-model",
      baseUrl: "https://api.x.ai/v1",
    });
  });

  it("odmítne neplatný timeout a počet opakování", () => {
    expect(() => readXaiConfig({ XAI_TIMEOUT_MS: "0" })).toThrow(TypeError);
    expect(() => readXaiConfig({ XAI_MAX_RETRIES: "1.5" })).toThrow(TypeError);
  });
});

describe("chat completions", () => {
  it("pošle text na /v1/chat/completions modelem z konfigurace a klíč jen v hlavičce", async () => {
    const { client, captured } = clientWith(async () => jsonResponse(completion("Dobrý den.")));
    const result = await client.chat({
      messages: [{ role: "user", content: "Potřebuji destičky." }],
    });

    expect(result.content).toBe("Dobrý den.");
    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toBe("https://api.x.ai/v1/chat/completions");
    expect(captured[0]?.url).not.toContain(API_KEY);
    const headers = captured[0]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${API_KEY}`);
    const body = bodyOf(captured[0]!);
    expect(body.model).toBe("grok-4.7");
    expect(body.stream).toBe(false);
    expect(body).not.toHaveProperty("frequency_penalty");
  });

  it("u vision použije vision model a pošle base64 i URL", async () => {
    const { client, captured } = clientWith(async () => jsonResponse(completion("kotouč")), {
      env: { XAI_TEXT_MODEL: "text-model", XAI_VISION_MODEL: "vision-model" },
      apiKey: API_KEY,
    });

    await client.chat({
      purpose: "vision",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: imageUrlFromSource({ kind: "base64", mediaType: "image/png", data: "aaaa" }) },
            },
            { type: "text", text: "Co je na fotce?" },
          ],
        },
      ],
    });
    expect(bodyOf(captured[0]!).model).toBe("vision-model");
    expect(JSON.stringify(bodyOf(captured[0]!).messages)).toContain("data:image/png;base64,aaaa");

    await client.chat({
      purpose: "text",
      messages: [{ role: "user", content: "A textem?" }],
    });
    expect(bodyOf(captured[1]!).model).toBe("text-model");
  });

  it("přečte tool call a pošle definici nástroje", async () => {
    const { client, captured } = clientWith(async () =>
      jsonResponse(
        completion(null, {
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "sklad", arguments: "{\"oem\":\"1K0\"}" },
            },
          ],
        }),
      ),
    );

    const result = await client.chat({
      messages: [{ role: "user", content: "Najdi OEM." }],
      tools: [
        {
          type: "function",
          function: {
            name: "sklad",
            description: "Interní dotaz. Nic neobjednává.",
            parameters: { type: "object", properties: { oem: { type: "string" } }, required: ["oem"] },
          },
        },
      ],
      toolChoice: "auto",
      parallelToolCalls: false,
    });

    expect(result.toolCalls).toEqual([{ id: "call_1", name: "sklad", arguments: "{\"oem\":\"1K0\"}" }]);
    const body = bodyOf(captured[0]!);
    expect(body.tools).toHaveLength(1);
    expect(body.tool_choice).toBe("auto");
    expect(body.parallel_tool_calls).toBe(false);
  });

  it("při 503 počká a zopakuje, při 401 ne a klíč z chyby smaže", async () => {
    let calls = 0;
    const { client, sleeps } = clientWith(async () => {
      calls += 1;
      if (calls < 3) return jsonResponse({ error: `down ${API_KEY}` }, 503, { "Retry-After": "2" });
      return jsonResponse(completion("hotovo"));
    });
    await expect(client.chat({ messages: [{ role: "user", content: "Ahoj" }] })).resolves.toMatchObject({
      content: "hotovo",
    });
    expect(calls).toBe(3);
    expect(sleeps).toEqual([2000, 2000]);

    let denied = 0;
    const failing = clientWith(async () => {
      denied += 1;
      return new Response(`key=${API_KEY}`, { status: 401 });
    });
    const error = await failing.client
      .chat({ messages: [{ role: "user", content: "Ahoj" }] })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(XaiError);
    expect((error as XaiError).retryable).toBe(false);
    expect((error as XaiError).message).toContain("[redacted]");
    expect((error as XaiError).message).not.toContain(API_KEY);
    expect(denied).toBe(1);
  });

  it("po vypršení času požadavek zopakuje a bez klíče síť nevolá", async () => {
    let calls = 0;
    const { client } = clientWith(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          calls += 1;
          const signal = init?.signal;
          const fail = () => {
            const error = new Error("timeout");
            error.name = "TimeoutError";
            reject(error);
          };
          if (!signal) {
            fail();
            return;
          }
          if (signal.aborted) fail();
          else signal.addEventListener("abort", fail, { once: true });
        }),
      { timeoutMs: 20, maxRetries: 1 },
    );
    await expect(client.chat({ messages: [{ role: "user", content: "Ahoj" }] })).rejects.toMatchObject({
      name: "XaiError",
      retryable: true,
    });
    expect(calls).toBe(2);

    let networked = 0;
    const unconfigured = createXaiClient({
      env: {},
      fetchImpl: async () => {
        networked += 1;
        return jsonResponse(completion("ne"));
      },
      sleep: async () => {},
    });
    await expect(unconfigured.chat({ messages: [{ role: "user", content: "Ahoj" }] })).rejects.toBeInstanceOf(
      XaiError,
    );
    expect(networked).toBe(0);
  });

  it("nic neloguje", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const { client } = clientWith(async () => jsonResponse(completion(`odpověď ${API_KEY}`)));
    await client.chat({ messages: [{ role: "user", content: "Ahoj" }] });
    expect(log).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(debug).not.toHaveBeenCalled();
  });
});

describe("stream a JSON", () => {
  it("složí text, oddělí reasoning a tool call z jednoho chunku", async () => {
    const toolChunk = {
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call_9",
                type: "function",
                function: { name: "sklad", arguments: "{\"oem\":\"1K0\"}" },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    };
    const { client, captured } = clientWith(async () =>
      streamResponse([
        'data: {"choices":[{"index":0,"delta":{"reasoning_content":"interní ',
        'úvaha Ovoko"}}]}\n\n',
        'data: {"choices":[{"index":0,"delta":{"content":"Dobrý den."}}]}\n\n',
        `data: ${JSON.stringify(toolChunk)}\n\n`,
        "data: [DONE]\n\n",
      ]),
    );

    const events = [];
    for await (const event of client.chatStream({
      messages: [{ role: "user", content: "Ahoj" }],
    })) {
      events.push(event);
    }

    expect(bodyOf(captured[0]!).stream).toBe(true);
    expect(events.map((event) => event.type)).toEqual(["reasoning", "text", "tool_call", "done"]);
    expect(events[0]).toMatchObject({ text: "interní úvaha Ovoko" });
    expect(events[1]).toMatchObject({ text: "Dobrý den." });
    expect(events[2]).toMatchObject({ toolCall: { id: "call_9", name: "sklad", arguments: "{\"oem\":\"1K0\"}" } });
    expect(events[3]).toMatchObject({
      finishReason: "tool_calls",
      message: { role: "assistant", content: "Dobrý den." },
    });
  });

  it("ověří JSON Zodem a do požadavku dá json_schema", async () => {
    const schema = z.object({
      replyCs: z.string().min(1),
      questionsAsked: z.number().int().min(0).max(3),
    });
    const { client, captured } = clientWith(async () =>
      jsonResponse(completion("```json\n{\"replyCs\":\"Jaké máte vozidlo?\",\"questionsAsked\":1,\"aiScore\":0.4}\n```")),
    );
    const parsed = await client.chatJson({
      schema,
      schemaName: "dilobot_turn",
      messages: [{ role: "user", content: "Destičky na Transporter." }],
    });
    expect(parsed).toEqual({ replyCs: "Jaké máte vozidlo?", questionsAsked: 1 });
    expect(parsed).not.toHaveProperty("aiScore");
    const format = bodyOf(captured[0]!).response_format as {
      type: string;
      json_schema: { name: string; strict: boolean; schema: Record<string, unknown> };
    };
    expect(format.type).toBe("json_schema");
    expect(format.json_schema.name).toBe("dilobot_turn");
    expect(format.json_schema.strict).toBe(true);
    expect(format.json_schema.schema.$schema).toBeUndefined();
    expect(format.json_schema.schema.additionalProperties).toBe(false);

    const invalid = clientWith(async () => jsonResponse(completion("{\"questionsAsked\":4}")));
    await expect(
      invalid.client.chatJson({
        schema,
        schemaName: "dilobot_turn",
        messages: [{ role: "user", content: "Ahoj" }],
      }),
    ).rejects.toBeInstanceOf(XaiSchemaError);
  });
});

describe("obrázek", () => {
  it("přijme https a jpeg base64 a odmítne cizí schéma i příliš velký soubor", () => {
    expect(imageUrlFromSource({ kind: "url", url: "https://cdn.example/dil.png", detail: "high" })).toBe(
      "https://cdn.example/dil.png",
    );
    expect(imageUrlFromSource({ kind: "base64", mediaType: "image/jpeg", data: "aaaa" })).toBe(
      "data:image/jpeg;base64,aaaa",
    );
    expect(() => imageUrlFromSource({ kind: "url", url: "javascript:alert(1)" })).toThrow(TypeError);
    expect(() => imageUrlFromSource({ kind: "base64", mediaType: "image/png", data: "aaa" })).toThrow(TypeError);
    expect(() =>
      imageUrlFromSource({ kind: "base64", mediaType: "image/gif" as "image/png", data: "aaaa" }),
    ).toThrow(TypeError);

    const tooBig = "A".repeat((Math.floor((20 * 1024 * 1024) / 3) + 1) * 4);
    expect(() => imageUrlFromSource({ kind: "base64", mediaType: "image/jpeg", data: tooBig })).toThrow(/20 MiB/);
  });
});
