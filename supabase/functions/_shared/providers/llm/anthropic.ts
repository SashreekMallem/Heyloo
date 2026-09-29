import { z } from "zod";
import { extractJsonObject } from "../../json-extract.ts";
import { classifyStatus, extractErrorMessage, type LlmTransport, requestJson } from "./http.ts";
import type {
  LlmBatchApi,
  LlmBatchResultItem,
  LlmChatRequest,
  LlmChatResponse,
  LlmClient,
  LlmContentPart,
  LlmError,
  LlmJsonRequest,
  LlmJsonResponse,
  LlmMessage,
  LlmResult,
  LlmTextRequest,
  LlmTextResponse,
  LlmTier,
  LlmToolCall,
  LlmUsage,
} from "./types.ts";
import { llmFailure, toInputParts } from "./types.ts";

/**
 * Anthropic adapter for the LLM port — the SECOND adapter (task LLM-1: the
 * owner chose Gemini; this stays available behind `LLM_PROVIDER=anthropic`).
 * Plain `fetch` against the Messages API (`POST /v1/messages`,
 * `x-api-key` + `anthropic-version: 2023-06-01`) and the Message Batches API
 * (`POST /v1/messages/batches`, `GET /v1/messages/batches/{id}`, JSONL results
 * at `results_url`). This is the pre-existing, previously verified integration
 * (docs/VERIFY.md "Anthropic") moved behind the port unchanged in behavior;
 * only the wrapper types are new. Image and PDF input use `image` / `document`
 * content blocks with `source: {type: "base64", media_type, data}`.
 *
 * Structured output: this adapter asks for strict JSON in the system prompt
 * (schema included) and parses the reply tolerantly — the same contract every
 * JSON call site in this codebase used before the port existed.
 */

export const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_BATCHES_URL = "https://api.anthropic.com/v1/messages/batches";
const ANTHROPIC_VERSION = "2023-06-01";

/** Pre-port defaults, unchanged (docs/VERIFY.md "Anthropic"). */
export const ANTHROPIC_DEFAULT_MODELS: Record<LlmTier, string> = {
  fast: "claude-haiku-4-5",
  quality: "claude-sonnet-5",
  vision: "claude-sonnet-5",
};

const BATCH_ID = /^msgbatch_[A-Za-z0-9]+$/;
export const ANTHROPIC_BATCH_ID_PATTERN = BATCH_ID;

const IMAGE_MEDIA_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;

export interface AnthropicClientConfig {
  apiKey: string;
  transport: LlmTransport;
  models?: Partial<Record<LlmTier, string>>;
}

const zContentBlock = z.object({
  type: z.string(),
  text: z.string().optional(),
  id: z.string().optional(),
  name: z.string().optional(),
  input: z.record(z.string(), z.unknown()).optional(),
});

const zMessageResponse = z.object({
  content: z.array(zContentBlock),
  stop_reason: z.string().nullable().optional(),
  usage: z
    .object({ input_tokens: z.number().optional(), output_tokens: z.number().optional() })
    .optional(),
});
type MessageResponse = z.infer<typeof zMessageResponse>;

function classifyAnthropicError(status: number, bodyText: string): LlmError {
  const message = extractErrorMessage(bodyText);
  // 529 = "overloaded_error": transient, retry like a 5xx.
  if (status === 529) return { kind: "unavailable", status, message, retryable: true };
  return classifyStatus(status, message);
}

function usageOf(body: MessageResponse): LlmUsage {
  return {
    inputTokens: body.usage?.input_tokens ?? 0,
    outputTokens: body.usage?.output_tokens ?? 0,
  };
}

function textOf(body: MessageResponse): string {
  return body.content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n")
    .trim();
}

function toBlocks(
  parts: LlmContentPart[],
): { ok: true; blocks: Record<string, unknown>[] } | { ok: false; error: LlmError } {
  const blocks: Record<string, unknown>[] = [];
  for (const p of parts) {
    if (p.kind === "text") {
      blocks.push({ type: "text", text: p.text });
    } else if (p.mimeType === "application/pdf") {
      blocks.push({
        type: "document",
        source: { type: "base64", media_type: p.mimeType, data: p.dataBase64 },
      });
    } else if ((IMAGE_MEDIA_TYPES as readonly string[]).includes(p.mimeType)) {
      blocks.push({
        type: "image",
        source: { type: "base64", media_type: p.mimeType, data: p.dataBase64 },
      });
    } else {
      return llmFailure("invalid_request", 0, `unsupported media type: ${p.mimeType}`);
    }
  }
  return { ok: true, blocks };
}

function jsonSystem(system: string | undefined, schema: Record<string, unknown>): string {
  const instruction =
    "Respond with ONLY a single JSON object that conforms to this JSON Schema. " +
    "No markdown fences, no commentary, no leading or trailing text.\n" +
    JSON.stringify(schema);
  return system ? `${system}\n\n${instruction}` : instruction;
}

function toAnthropicMessages(messages: LlmMessage[]): Record<string, unknown>[] {
  return messages.map((m) => {
    if (m.role === "user") return { role: "user", content: m.text };
    if (m.role === "assistant") {
      const content: Record<string, unknown>[] = [];
      if (m.text) content.push({ type: "text", text: m.text });
      for (const call of m.toolCalls ?? []) {
        content.push({ type: "tool_use", id: call.id, name: call.name, input: call.args });
      }
      return { role: "assistant", content };
    }
    return {
      role: "user",
      content: m.results.map((r) => ({
        type: "tool_result",
        tool_use_id: r.callId,
        content: r.content,
        ...(r.isError ? { is_error: true } : {}),
      })),
    };
  });
}

// ---------------------------------------------------------------------------
// Batch response shapes
// ---------------------------------------------------------------------------

const zBatchStatus = z.object({
  processing_status: z.string().optional(),
  results_url: z.string().nullable().optional(),
});
const zBatchResultLine = z.object({
  custom_id: z.string(),
  result: z.object({
    type: z.string(),
    message: z.object({ content: z.array(zContentBlock) }).optional(),
  }),
});

export function createAnthropicClient(config: AnthropicClientConfig): LlmClient {
  const modelFor = (tier: LlmTier): string =>
    config.models?.[tier] ?? ANTHROPIC_DEFAULT_MODELS[tier];
  const headers = {
    "x-api-key": config.apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
    "content-type": "application/json",
  };

  async function send(
    req: LlmTextRequest | LlmJsonRequest | LlmChatRequest,
    body: Record<string, unknown>,
  ): Promise<LlmResult<{ body: MessageResponse; model: string }>> {
    const model = req.model ?? modelFor(req.tier ?? "fast");
    const res = await requestJson({
      transport: config.transport,
      url: ANTHROPIC_MESSAGES_URL,
      headers,
      body: {
        model,
        max_tokens: req.maxOutputTokens,
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...body,
      },
      timeoutMs: req.timeoutMs,
      maxRetries: req.maxRetries,
      totalTimeoutMs: req.totalTimeoutMs,
      classify: classifyAnthropicError,
    });
    if (!res.ok) return { ok: false, error: res.error };
    const parsed = zMessageResponse.safeParse(res.json);
    if (!parsed.success) {
      return llmFailure("bad_response", res.status, "response did not match the documented shape");
    }
    if (parsed.data.stop_reason === "refusal") {
      return llmFailure("blocked", res.status, "the model declined to answer");
    }
    return { ok: true, body: parsed.data, model };
  }

  async function generateText(req: LlmTextRequest): Promise<LlmResult<LlmTextResponse>> {
    const content = toBlocks(toInputParts(req.input));
    if (!content.ok) return content;
    const result = await send(req, {
      ...(req.system ? { system: req.system } : {}),
      messages: [{ role: "user", content: content.blocks }],
    });
    if (!result.ok) return result;
    const text = textOf(result.body);
    if (!text) return llmFailure("bad_response", 200, "empty text response");
    return {
      ok: true,
      text,
      finishReason: result.body.stop_reason === "max_tokens" ? "length" : "stop",
      usage: usageOf(result.body),
      model: result.model,
    };
  }

  async function generateJson(req: LlmJsonRequest): Promise<LlmResult<LlmJsonResponse>> {
    const content = toBlocks(toInputParts(req.input));
    if (!content.ok) return content;
    const result = await send(req, {
      system: jsonSystem(req.system, req.schema),
      messages: [{ role: "user", content: content.blocks }],
    });
    if (!result.ok) return result;
    const text = textOf(result.body);
    if (!text) return llmFailure("bad_response", 200, "empty JSON response");
    let json: unknown;
    try {
      json = extractJsonObject(text);
    } catch {
      return result.body.stop_reason === "max_tokens"
        ? llmFailure("truncated", 200, "JSON output was cut off at the token cap")
        : llmFailure("bad_response", 200, "response text was not valid JSON");
    }
    return { ok: true, json, text, usage: usageOf(result.body), model: result.model };
  }

  async function chat(req: LlmChatRequest): Promise<LlmResult<LlmChatResponse>> {
    const result = await send(req, {
      ...(req.system ? { system: req.system } : {}),
      messages: toAnthropicMessages(req.messages),
      ...(req.tools && req.tools.length > 0
        ? {
            tools: req.tools.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: t.inputSchema,
            })),
          }
        : {}),
    });
    if (!result.ok) return result;
    const toolCalls: LlmToolCall[] = [];
    for (const block of result.body.content) {
      if (block.type === "tool_use" && block.id && block.name) {
        toolCalls.push({ id: block.id, name: block.name, args: block.input ?? {} });
      }
    }
    const text = textOf(result.body);
    if (toolCalls.length === 0 && !text) {
      return llmFailure("bad_response", 200, "empty chat response");
    }
    const stopReason: LlmChatResponse["stopReason"] =
      result.body.stop_reason === "tool_use" && toolCalls.length > 0
        ? "tool_use"
        : result.body.stop_reason === "max_tokens"
          ? "max_tokens"
          : "end_turn";
    return {
      ok: true,
      text,
      toolCalls: stopReason === "tool_use" ? toolCalls : [],
      stopReason,
      assistantMessage: {
        role: "assistant",
        ...(text ? { text } : {}),
        ...(stopReason === "tool_use" ? { toolCalls } : {}),
      },
      usage: usageOf(result.body),
      model: result.model,
    };
  }

  const batch: LlmBatchApi = {
    async submit({ tier, model, requests }) {
      const useModel = model ?? modelFor(tier ?? "fast");
      const res = await requestJson({
        transport: config.transport,
        url: ANTHROPIC_BATCHES_URL,
        headers,
        body: {
          requests: requests.map((r) => ({
            custom_id: r.key,
            params: {
              model: useModel,
              max_tokens: r.maxOutputTokens,
              ...(r.system ? { system: r.system } : {}),
              messages: [{ role: "user", content: r.input }],
            },
          })),
        },
        classify: classifyAnthropicError,
      });
      if (!res.ok) return { ok: false, error: res.error };
      const id = z.object({ id: z.string() }).safeParse(res.json);
      if (!id.success || !BATCH_ID.test(id.data.id)) {
        return llmFailure("bad_response", res.status, "batch create response had no batch id");
      }
      return { ok: true, batchId: id.data.id };
    },

    async get(batchId) {
      if (!BATCH_ID.test(batchId))
        return llmFailure("invalid_request", 0, "not an Anthropic batch id");
      const statusRes = await requestJson({
        transport: config.transport,
        url: `${ANTHROPIC_BATCHES_URL}/${batchId}`,
        method: "GET",
        headers: { "x-api-key": config.apiKey, "anthropic-version": ANTHROPIC_VERSION },
        classify: classifyAnthropicError,
      });
      if (!statusRes.ok) return { ok: false, error: statusRes.error };
      const status = zBatchStatus.safeParse(statusRes.json);
      if (!status.success) {
        return llmFailure(
          "bad_response",
          statusRes.status,
          "batch status did not match the documented shape",
        );
      }
      if (status.data.processing_status !== "ended" || !status.data.results_url) {
        return { ok: true, status: { state: "in_progress" } };
      }
      const resultsRes = await requestJson({
        transport: config.transport,
        url: status.data.results_url,
        method: "GET",
        headers: { "x-api-key": config.apiKey, "anthropic-version": ANTHROPIC_VERSION },
        responseType: "text",
        classify: classifyAnthropicError,
      });
      if (!resultsRes.ok) return { ok: false, error: resultsRes.error };
      const results: LlmBatchResultItem[] = [];
      // JSONL, in ANY order per the Batches contract — callers key off `key`.
      for (const line of resultsRes.text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let raw: unknown;
        try {
          raw = JSON.parse(trimmed);
        } catch {
          continue; // a malformed line must not fail the whole collection
        }
        const parsed = zBatchResultLine.safeParse(raw);
        if (!parsed.success) continue;
        const { custom_id, result } = parsed.data;
        const text =
          result.type === "succeeded" && result.message
            ? (result.message.content.find((c) => c.type === "text")?.text ?? null)
            : null;
        results.push({ key: custom_id, text });
      }
      return { ok: true, status: { state: "succeeded", results } };
    },
  };

  return { provider: "anthropic", modelFor, generateText, generateJson, chat, batch };
}
