import "server-only";

import { z, type ZodType } from "zod";

/**
 * Serverový klient xAI.
 *
 * Formát podle zadání: POST {baseUrl}/chat/completions, OpenAI-kompatibilní
 * chat completions (https://docs.x.ai/developers/model-capabilities/legacy/chat-completions).
 * Dokumentace xAI označuje chat completions jako starší rozhraní a novinky dává
 * do Responses API. Tenhle krok zůstává u chat completions, jak je v zadání.
 *
 * grok-4.7 bere text i obrázky. Samostatné ID „grok-vision“ v API není,
 * proto mají text i vision stejné výchozí ID a obě se čtou z prostředí.
 * Klíč se neloguje a z textů chyb se maže.
 */

export const DEFAULT_XAI_BASE_URL = "https://api.x.ai/v1";
export const DEFAULT_XAI_MODEL = "grok-4.7";
export const DEFAULT_TIMEOUT_MS = 120_000;
export const DEFAULT_MAX_RETRIES = 2;

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export class XaiError extends Error {
  readonly status: number | null;
  readonly retryable: boolean;

  constructor(message: string, options?: { status?: number | null; retryable?: boolean; cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "XaiError";
    this.status = options?.status ?? null;
    this.retryable = options?.retryable ?? false;
  }
}

export class XaiSchemaError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Odpověď modelu neodpovídá schématu: ${issues.join("; ")}`);
    this.name = "XaiSchemaError";
    this.issues = issues;
  }
}

export type XaiConfig = {
  apiKey: string;
  baseUrl: string;
  textModel: string;
  visionModel: string;
  timeoutMs: number;
  maxRetries: number;
};

export function readXaiConfig(env: Record<string, string | undefined> = process.env): XaiConfig {
  const timeoutRaw = env.XAI_TIMEOUT_MS;
  const retriesRaw = env.XAI_MAX_RETRIES;
  const timeoutMs = timeoutRaw === undefined || timeoutRaw.trim() === "" ? DEFAULT_TIMEOUT_MS : Number(timeoutRaw);
  const maxRetries = retriesRaw === undefined || retriesRaw.trim() === "" ? DEFAULT_MAX_RETRIES : Number(retriesRaw);

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("XAI_TIMEOUT_MS musí být kladné číslo.");
  }
  if (!Number.isInteger(maxRetries) || maxRetries < 0) {
    throw new TypeError("XAI_MAX_RETRIES musí být nezáporné celé číslo.");
  }

  return {
    apiKey: env.XAI_API_KEY?.trim() ?? "",
    baseUrl: (env.XAI_BASE_URL?.trim() || DEFAULT_XAI_BASE_URL).replace(/\/+$/, ""),
    textModel: env.XAI_TEXT_MODEL?.trim() || DEFAULT_XAI_MODEL,
    visionModel: env.XAI_VISION_MODEL?.trim() || DEFAULT_XAI_MODEL,
    timeoutMs,
    maxRetries,
  };
}

export function redactSecret(text: string, secret: string): string {
  if (!secret) return text;
  return text.split(secret).join("[redacted]");
}

export type XaiImageDetail = "auto" | "low" | "high";

export type XaiImageSource =
  | { kind: "url"; url: string; detail?: XaiImageDetail }
  | { kind: "base64"; mediaType: "image/jpeg" | "image/png"; data: string; detail?: XaiImageDetail };

export type XaiContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: XaiImageDetail } };

export type XaiToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type XaiTool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
};

export type XaiToolChoice =
  | "auto"
  | "none"
  | "required"
  | { type: "function"; function: { name: string } };

export type XaiMessage =
  | { role: "system" | "user"; content: string | XaiContentPart[] }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    }
  | { role: "tool"; content: string; tool_call_id: string };

export type XaiResponseFormat = {
  type: "json_schema";
  json_schema: {
    name: string;
    strict: true;
    schema: Record<string, unknown>;
  };
};

export type XaiChatRequest = {
  messages: XaiMessage[];
  purpose?: "text" | "vision";
  model?: string;
  tools?: XaiTool[];
  toolChoice?: XaiToolChoice;
  parallelToolCalls?: boolean;
  responseFormat?: XaiResponseFormat;
  maxCompletionTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type XaiChatResult = {
  id: string;
  model: string;
  content: string | null;
  reasoningContent: string | null;
  refusal: string | null;
  toolCalls: XaiToolCall[];
  finishReason: string | null;
};

export type XaiAssistantMessage = Extract<XaiMessage, { role: "assistant" }>;

export type XaiStreamEvent =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool_call"; toolCall: XaiToolCall }
  | { type: "done"; finishReason: string | null; message: XaiAssistantMessage };

export type XaiJsonRequest<T> = Omit<XaiChatRequest, "responseFormat"> & {
  schema: ZodType<T>;
  schemaName: string;
};

export type XaiClientOptions = {
  env?: Record<string, string | undefined>;
  apiKey?: string;
  baseUrl?: string;
  textModel?: string;
  visionModel?: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

type ToolAccumulator = {
  id: string;
  name: string;
  arguments: string;
  emitted: boolean;
};

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

function isRetryableTransport(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "TimeoutError" || error.name === "AbortError" || error.name === "TypeError";
}

function startTimeout(ms: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException("The operation timed out.", "TimeoutError"));
  }, ms);
  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timer),
  };
}

function delayMs(attempt: number, response?: Response): number {
  const header = response?.headers.get("retry-after");
  if (header && /^\d+$/.test(header)) {
    return Math.min(Number(header) * 1000, 30_000);
  }
  const jitter = Math.floor(Math.random() * 100);
  return Math.min(250 * 2 ** attempt + jitter, 8_000);
}

function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced?.[1]?.trim() ?? trimmed;
}

function jsonSchemaFromZod(schema: ZodType): Record<string, unknown> {
  const converted = z.toJSONSchema(schema) as Record<string, unknown>;
  delete converted.$schema;
  return converted;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseToolCalls(value: unknown): XaiToolCall[] {
  if (!Array.isArray(value)) return [];
  const calls: XaiToolCall[] = [];
  for (const item of value) {
    if (!isRecord(item) || !isRecord(item.function)) continue;
    if (typeof item.id !== "string" || typeof item.function.name !== "string") continue;
    calls.push({
      id: item.id,
      name: item.function.name,
      arguments: typeof item.function.arguments === "string" ? item.function.arguments : "",
    });
  }
  return calls;
}

function parseCompletion(payload: unknown): XaiChatResult {
  if (!isRecord(payload) || !Array.isArray(payload.choices) || payload.choices.length === 0) {
    throw new XaiError("xAI nevrátilo žádnou volbu.", { retryable: false });
  }
  const choice = payload.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message)) {
    throw new XaiError("xAI nevrátilo zprávu.", { retryable: false });
  }
  const message = choice.message;
  return {
    id: typeof payload.id === "string" ? payload.id : "",
    model: typeof payload.model === "string" ? payload.model : "",
    content: typeof message.content === "string" ? message.content : null,
    reasoningContent: typeof message.reasoning_content === "string" ? message.reasoning_content : null,
    refusal: typeof message.refusal === "string" ? message.refusal : null,
    toolCalls: parseToolCalls(message.tool_calls),
    finishReason: typeof choice.finish_reason === "string" ? choice.finish_reason : null,
  };
}

function assistantMessage(content: string, toolCalls: XaiToolCall[]): XaiAssistantMessage {
  const message: XaiAssistantMessage = {
    role: "assistant",
    content: content || null,
  };
  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls.map((call) => ({
      id: call.id,
      type: "function",
      function: { name: call.name, arguments: call.arguments },
    }));
  }
  return message;
}

function isCompleteJson(value: string): boolean {
  if (!value) return false;
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

function absorbToolDelta(calls: Map<number, ToolAccumulator>, delta: unknown): void {
  if (!isRecord(delta)) return;
  const index = typeof delta.index === "number" ? delta.index : calls.size;
  const current = calls.get(index) ?? { id: "", name: "", arguments: "", emitted: false };
  if (typeof delta.id === "string" && delta.id) current.id = delta.id;
  if (isRecord(delta.function)) {
    if (typeof delta.function.name === "string" && delta.function.name && !current.name) {
      current.name = delta.function.name;
    }
    if (typeof delta.function.arguments === "string" && delta.function.arguments) {
      current.arguments += delta.function.arguments;
    }
  }
  calls.set(index, current);
}

function takeReadyToolCalls(calls: Map<number, ToolAccumulator>, force: boolean): XaiStreamEvent[] {
  const events: XaiStreamEvent[] = [];
  for (const call of calls.values()) {
    if (call.emitted || !call.id || !call.name) continue;
    const ready = force || isCompleteJson(call.arguments);
    if (!ready) continue;
    if (!call.arguments) call.arguments = "{}";
    call.emitted = true;
    events.push({
      type: "tool_call",
      toolCall: { id: call.id, name: call.name, arguments: call.arguments },
    });
  }
  return events;
}

async function* readSseData(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const takeBlocks = function* (flush: boolean): Generator<string> {
    const normalized = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const blocks = normalized.split("\n\n");
    buffer = flush ? "" : (blocks.pop() ?? "");
    for (const block of blocks) {
      if (block.trim()) yield block;
    }
  };

  const parseBlock = (block: string): unknown => {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) return undefined;
    if (data === "[DONE]") return Symbol.for("xai.done");
    try {
      return JSON.parse(data) as unknown;
    } catch (cause) {
      throw new XaiError("xAI poslalo nečitelný stream.", { retryable: false, cause });
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (const block of takeBlocks(false)) {
        const parsed = parseBlock(block);
        if (parsed === Symbol.for("xai.done")) return;
        if (parsed !== undefined) yield parsed;
      }
    }
    buffer += decoder.decode();
    for (const block of takeBlocks(true)) {
      const parsed = parseBlock(block);
      if (parsed === Symbol.for("xai.done")) return;
      if (parsed !== undefined) yield parsed;
    }
  } finally {
    reader.releaseLock();
  }
}

async function* streamEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<XaiStreamEvent> {
  let text = "";
  let finishReason: string | null = null;
  const tools = new Map<number, ToolAccumulator>();

  for await (const payload of readSseData(body)) {
    if (!isRecord(payload) || !Array.isArray(payload.choices) || !isRecord(payload.choices[0])) {
      continue;
    }
    const choice = payload.choices[0];
    if (typeof choice.finish_reason === "string") finishReason = choice.finish_reason;
    const delta = isRecord(choice.delta) ? choice.delta : {};

    if (typeof delta.content === "string" && delta.content) {
      text += delta.content;
      yield { type: "text", text: delta.content };
    }
    if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
      yield { type: "reasoning", text: delta.reasoning_content };
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const toolDelta of delta.tool_calls) absorbToolDelta(tools, toolDelta);
      for (const event of takeReadyToolCalls(tools, false)) yield event;
    }
  }

  for (const event of takeReadyToolCalls(tools, true)) yield event;
  const toolCalls = [...tools.values()].map((call) => ({
    id: call.id,
    name: call.name,
    arguments: call.arguments || "{}",
  }));
  yield {
    type: "done",
    finishReason,
    message: assistantMessage(text, toolCalls),
  };
}

export function imageUrlFromSource(source: XaiImageSource): string {
  const detail = source.detail ?? "auto";
  if (detail !== "auto" && detail !== "low" && detail !== "high") {
    throw new TypeError("Detail obrázku musí být auto, low nebo high.");
  }

  if (source.kind === "url") {
    let parsed: URL;
    try {
      parsed = new URL(source.url);
    } catch {
      throw new TypeError("URL obrázku není platná.");
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new TypeError("URL obrázku musí být http nebo https.");
    }
    return source.url;
  }

  if (source.mediaType !== "image/jpeg" && source.mediaType !== "image/png") {
    throw new TypeError("Obrázek musí být JPEG nebo PNG.");
  }
  const data = source.data.replace(/\s/g, "");
  if (data.startsWith("data:")) {
    throw new TypeError("Base64 předávejte bez prefixu data URL.");
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data) || data.length % 4 !== 0) {
    throw new TypeError("Base64 obrázku není platné.");
  }
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  const bytes = (data.length / 4) * 3 - padding;
  if (bytes > MAX_IMAGE_BYTES) {
    throw new TypeError("Obrázek je větší než 20 MiB.");
  }
  return `data:${source.mediaType};base64,${data}`;
}

export function userImageMessage(source: XaiImageSource, text: string): XaiMessage {
  return {
    role: "user",
    content: [
      {
        type: "image_url",
        image_url: {
          url: imageUrlFromSource(source),
          detail: source.detail ?? "auto",
        },
      },
      { type: "text", text },
    ],
  };
}

export class XaiClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly textModel: string;
  private readonly visionModel: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(config: XaiConfig & Pick<XaiClientOptions, "fetchImpl" | "sleep">) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl;
    this.textModel = config.textModel;
    this.visionModel = config.visionModel;
    this.timeoutMs = config.timeoutMs;
    this.maxRetries = config.maxRetries;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.sleep = config.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  ensureConfigured(): void {
    if (!this.apiKey) {
      throw new XaiError("Chybí přístup k modelu.", { retryable: false });
    }
  }

  async chat(request: XaiChatRequest): Promise<XaiChatResult> {
    const response = await this.post(this.buildBody(request, false), request);
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (cause) {
      throw new XaiError("xAI vrátilo nečitelnou odpověď.", { retryable: false, cause });
    }
    return parseCompletion(payload);
  }

  async *chatStream(request: XaiChatRequest): AsyncGenerator<XaiStreamEvent> {
    const response = await this.post(this.buildBody(request, true), request);
    if (!response.body) {
      throw new XaiError("xAI nevrátilo tělo streamu.", { retryable: true });
    }
    yield* streamEvents(response.body);
  }

  async chatJson<T>(request: XaiJsonRequest<T>): Promise<T> {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(request.schemaName)) {
      throw new TypeError("Název schématu smí obsahovat jen písmena, čísla, _ a -.");
    }
    const result = await this.chat({
      ...request,
      responseFormat: {
        type: "json_schema",
        json_schema: {
          name: request.schemaName,
          strict: true,
          schema: jsonSchemaFromZod(request.schema),
        },
      },
    });
    if (result.refusal) {
      throw new XaiError("Model odmítl odpovědět.", { retryable: false });
    }
    if (!result.content) {
      throw new XaiSchemaError(["Odpověď neobsahuje JSON."]);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripJsonFence(result.content));
    } catch {
      throw new XaiSchemaError(["Odpověď není platný JSON."]);
    }
    const checked = request.schema.safeParse(parsed);
    if (!checked.success) {
      throw new XaiSchemaError(
        checked.error.issues.map((issue) => `${issue.path.join(".") || "(kořen)"}: ${issue.message}`),
      );
    }
    return checked.data;
  }

  private buildBody(request: XaiChatRequest, stream: boolean): Record<string, unknown> {
    if (!Array.isArray(request.messages) || request.messages.length === 0) {
      throw new TypeError("Konverzace musí obsahovat aspoň jednu zprávu.");
    }
    const model =
      request.model ?? (request.purpose === "vision" ? this.visionModel : this.textModel);
    const body: Record<string, unknown> = {
      model,
      messages: request.messages,
      stream,
    };
    if (request.tools) body.tools = request.tools;
    if (request.toolChoice) body.tool_choice = request.toolChoice;
    if (request.parallelToolCalls !== undefined) body.parallel_tool_calls = request.parallelToolCalls;
    if (request.responseFormat) body.response_format = request.responseFormat;
    if (request.maxCompletionTokens !== undefined) body.max_completion_tokens = request.maxCompletionTokens;
    if (request.temperature !== undefined) body.temperature = request.temperature;
    return body;
  }

  private async post(body: unknown, request: XaiChatRequest): Promise<Response> {
    this.ensureConfigured();
    const url = `${this.baseUrl}/chat/completions`;
    const timeoutMs = request.timeoutMs ?? this.timeoutMs;
    const attempts = this.maxRetries + 1;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (request.signal?.aborted) {
        throw new XaiError("Požadavek byl zrušen.", { retryable: false });
      }

      const timeout = startTimeout(timeoutMs);
      const signal = request.signal ? AbortSignal.any([request.signal, timeout.signal]) : timeout.signal;
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal,
        });
      } catch (error) {
        timeout.cancel();
        const cancelled = request.signal?.aborted === true;
        const retryable = !cancelled && isRetryableTransport(error);
        const wrapped = new XaiError(
          cancelled
            ? "Požadavek byl zrušen."
            : isTimeout(error)
              ? "Požadavek na xAI vypršel."
              : "Požadavek na xAI se nepodařilo odeslat.",
          { retryable, cause: error },
        );
        lastError = wrapped;
        if (!retryable || attempt === attempts - 1) throw wrapped;
        await this.sleep(delayMs(attempt));
        continue;
      } finally {
        timeout.cancel();
      }

      if (response.ok) return response;

      const snippet = redactSecret(await response.text(), this.apiKey).slice(0, 300);
      const retryable = RETRYABLE_STATUS.has(response.status);
      const httpError = new XaiError(
        snippet ? `xAI vrátilo HTTP ${response.status}: ${snippet}` : `xAI vrátilo HTTP ${response.status}.`,
        { status: response.status, retryable },
      );
      lastError = httpError;
      if (!retryable || attempt === attempts - 1) throw httpError;
      await this.sleep(delayMs(attempt, response));
    }

    throw lastError ?? new XaiError("Požadavek na xAI selhal.", { retryable: false });
  }
}

export function createXaiClient(options: XaiClientOptions = {}): XaiClient {
  const envConfig = readXaiConfig(options.env ?? process.env);
  return new XaiClient({
    apiKey: options.apiKey ?? envConfig.apiKey,
    baseUrl: (options.baseUrl ?? envConfig.baseUrl).replace(/\/+$/, ""),
    textModel: options.textModel ?? envConfig.textModel,
    visionModel: options.visionModel ?? envConfig.visionModel,
    timeoutMs: options.timeoutMs ?? envConfig.timeoutMs,
    maxRetries: options.maxRetries ?? envConfig.maxRetries,
    fetchImpl: options.fetchImpl,
    sleep: options.sleep,
  });
}
