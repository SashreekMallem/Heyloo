import { z } from "zod";
import { extractJsonObject } from "../../json-extract.ts";
import { classifyStatus, extractErrorMessage, type LlmTransport, requestJson } from "./http.ts";
import type {
  LlmBatchApi,
  LlmBatchRequestItem,
  LlmBatchResultItem,
  LlmBatchStatus,
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
 * Google Gemini adapter for the LLM port (task LLM-1) — plain `fetch` against
 * the Gemini Developer API `generateContent` REST method (Deno edge runtime:
 * no SDK; same pattern as every other `_shared/providers/*.ts`).
 *
 * Verified against the CURRENT official docs on 2026-09-29 (CLAUDE.md Rule 1;
 * URLs and the open points are logged in docs/VERIFY.md "Google Gemini"):
 *   - Endpoint  POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
 *               (ai.google.dev/api/generate-content)
 *   - Auth      `x-goog-api-key: <key>` header (ai.google.dev/gemini-api/docs/api-key)
 *               — never the `?key=` query form, so the key cannot land in a URL/log.
 *   - Request   `contents[]` (role `user`|`model`, `parts[]`), `systemInstruction`,
 *               `tools[].functionDeclarations[]` (`parametersJsonSchema` takes plain
 *               JSON Schema), `generationConfig` (`maxOutputTokens`, `temperature`,
 *               `responseMimeType`, `responseJsonSchema`), optional `safetySettings`.
 *   - Media     `parts[].inlineData {mimeType, data(base64)}`; images and PDF
 *               (`application/pdf`, up to 50MB/1000 pages; whole request <= 20MB inline).
 *   - Response  `candidates[].content.parts[]` (`text`, `functionCall {id?, name, args}`,
 *               `thoughtSignature`), `candidates[].finishReason`, `usageMetadata
 *               {promptTokenCount, candidatesTokenCount, thoughtsTokenCount}`,
 *               `promptFeedback.blockReason`.
 *   - Tool loop a `functionCall` part is answered by a `user` content holding a
 *               `functionResponse {id?, name, response{...}}` part. Gemini 3 models
 *               attach a `thoughtSignature` to function-call parts; it MUST be echoed
 *               back unchanged (carried here as opaque `providerState`).
 *   - Temperature: Gemini 3+ "strongly recommend keeping the temperature parameter at its
 *     default value of 1.0" (ai.google.dev/gemini-api/docs/gemini-3), so a caller's
 *     `temperature` is only sent to older models. Structured output is schema-constrained.
 *   - `maxOutputTokens` counts reasoning ("thinking") tokens too, so this adapter
 *     adds `thinkingHeadroomTokens` to the caller's visible-answer cap.
 * Every response is zod-validated at this boundary; anything off-shape becomes a
 * classified `bad_response`, never a thrown error or a guessed value.
 */

export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";
/** Fast, cheap, stable model (ai.google.dev/gemini-api/docs/models, 2026-09-29):
 * "cost-efficient ... high-volume agentic tasks ... simple data processing",
 * multimodal (text/image/PDF in), function calling, structured output,
 * default thinking level `minimal`. $0.30 / $2.50 per 1M tokens. */
export const GEMINI_DEFAULT_MODEL = "gemini-3.5-flash-lite";
export const GEMINI_DEFAULT_THINKING_HEADROOM_TOKENS = 1024;

export type GeminiSafetyThreshold =
  | "BLOCK_LOW_AND_ABOVE"
  | "BLOCK_MEDIUM_AND_ABOVE"
  | "BLOCK_ONLY_HIGH"
  | "BLOCK_NONE"
  | "OFF";

export const GEMINI_SAFETY_THRESHOLDS: readonly GeminiSafetyThreshold[] = [
  "BLOCK_LOW_AND_ABOVE",
  "BLOCK_MEDIUM_AND_ABOVE",
  "BLOCK_ONLY_HIGH",
  "BLOCK_NONE",
  "OFF",
];

const SAFETY_CATEGORIES = [
  "HARM_CATEGORY_HARASSMENT",
  "HARM_CATEGORY_HATE_SPEECH",
  "HARM_CATEGORY_SEXUALLY_EXPLICIT",
  "HARM_CATEGORY_DANGEROUS_CONTENT",
] as const;

export interface GeminiClientConfig {
  apiKey: string;
  transport: LlmTransport;
  baseUrl?: string;
  /** Concrete model per tier; unset tiers fall back to `GEMINI_DEFAULT_MODEL`. */
  models?: Partial<Record<LlmTier, string>>;
  /** Extra output-token allowance for reasoning tokens (they count against
   * `maxOutputTokens`). */
  thinkingHeadroomTokens?: number;
  /** Explicit harm-block threshold for the four adjustable categories. Unset =
   * the model default (documented as Off for Gemini 2.0+ / 3.x). */
  safetyThreshold?: GeminiSafetyThreshold;
}

// ---------------------------------------------------------------------------
// Response schemas (the documented shapes, only the fields this adapter reads)
// ---------------------------------------------------------------------------

const zFunctionCall = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  args: z.record(z.string(), z.unknown()).optional(),
});

const zPart = z.object({
  text: z.string().optional(),
  thought: z.boolean().optional(),
  thoughtSignature: z.string().optional(),
  functionCall: zFunctionCall.optional(),
});

const zCandidate = z.object({
  content: z.object({ parts: z.array(zPart).optional(), role: z.string().optional() }).optional(),
  finishReason: z.string().optional(),
  finishMessage: z.string().optional(),
});

const zUsage = z.object({
  promptTokenCount: z.number().optional(),
  candidatesTokenCount: z.number().optional(),
  thoughtsTokenCount: z.number().optional(),
  toolUsePromptTokenCount: z.number().optional(),
});

export const zGeminiGenerateContentResponse = z.object({
  candidates: z.array(zCandidate).optional(),
  usageMetadata: zUsage.optional(),
  promptFeedback: z
    .object({ blockReason: z.string().optional(), blockReasonMessage: z.string().optional() })
    .optional(),
  modelVersion: z.string().optional(),
});
export type GeminiGenerateContentResponse = z.infer<typeof zGeminiGenerateContentResponse>;

/** Opaque per-call state we round-trip: the reasoning signature and the
 * vendor's own call id (when it sent one). */
const zCallState = z.object({
  thoughtSignature: z.string().optional(),
  providerCallId: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** finishReason values that mean "the safety layer stopped this" (documented
 * FinishReason enum, ai.google.dev/api/generate-content). */
const BLOCKED_FINISH_REASONS = new Set([
  "SAFETY",
  "RECITATION",
  "BLOCKLIST",
  "PROHIBITED_CONTENT",
  "SPII",
  "IMAGE_SAFETY",
  "IMAGE_PROHIBITED_CONTENT",
  "IMAGE_RECITATION",
  "LANGUAGE",
  "PUP_LIMITED_DISABLED",
  "ESCALATION",
]);

function toolCallsFromParts(parts: z.infer<typeof zPart>[], idPrefix: string): LlmToolCall[] {
  const calls: LlmToolCall[] = [];
  for (const part of parts) {
    if (!part.functionCall) continue;
    const providerCallId = part.functionCall.id;
    calls.push({
      id: providerCallId ?? `${idPrefix}-${calls.length}`,
      name: part.functionCall.name,
      args: part.functionCall.args ?? {},
      providerState: {
        ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}),
        ...(providerCallId ? { providerCallId } : {}),
      },
    });
  }
  return calls;
}

function toGeminiParts(parts: LlmContentPart[]): Record<string, unknown>[] {
  return parts.map((p) =>
    p.kind === "text"
      ? { text: p.text }
      : { inlineData: { mimeType: p.mimeType, data: p.dataBase64 } },
  );
}

function usageOf(body: GeminiGenerateContentResponse): LlmUsage {
  const u = body.usageMetadata;
  return {
    inputTokens: (u?.promptTokenCount ?? 0) + (u?.toolUsePromptTokenCount ?? 0),
    outputTokens: (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0),
  };
}

function classifyGeminiError(status: number, bodyText: string): LlmError {
  const message = extractErrorMessage(bodyText);
  // Bad/missing key surfaces as 400 INVALID_ARGUMENT "API key not valid" on the
  // generateContent surface — an operator problem, not a request bug.
  if (status === 400 && /api key|api_key/i.test(message)) {
    return { kind: "auth", status, message, retryable: false };
  }
  // FAILED_PRECONDITION (400): billing not enabled / region unsupported.
  if (status === 400 && /precondition|billing/i.test(message)) {
    return { kind: "payment", status, message, retryable: false };
  }
  return classifyStatus(status, message);
}

/** Gemini 3 and later: temperature stays at the default 1.0 (see `baseBody`). */
function keepsDefaultTemperature(model: string): boolean {
  return /^(?:models\/)?gemini-(?:[3-9]|\d{2,})/.test(model);
}

/** Inline media types the Gemini API accepts (ai.google.dev/gemini-api/docs/
 * image-understanding "Supported image formats" + document-processing): GIF is
 * NOT among them, so it is refused locally with a clear error instead of a
 * round trip that ends in an opaque 400. */
const GEMINI_MEDIA_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
]);

function unsupportedMediaType(input: LlmTextRequest["input"]): string | undefined {
  for (const part of toInputParts(input)) {
    if (part.kind === "media" && !GEMINI_MEDIA_TYPES.has(part.mimeType.toLowerCase())) {
      return part.mimeType;
    }
  }
  return undefined;
}

/** `GEMINI_MODEL` may be written `models/<id>` (the docs' resource form): the
 * bare id is what pricing and cost categorisation key on. */
function bareModelId(model: string): string {
  return model.replace(/^models\//, "");
}

function modelPath(model: string): string {
  return `models/${encodeURIComponent(model.replace(/^models\//, ""))}`;
}

type GeminiContent = { role: "user" | "model"; parts: Record<string, unknown>[] };

function toGeminiContents(messages: LlmMessage[]): GeminiContent[] {
  const contents: GeminiContent[] = [];
  const push = (role: GeminiContent["role"], parts: Record<string, unknown>[]) => {
    if (parts.length === 0) return;
    const last = contents[contents.length - 1];
    // Consecutive same-role turns are merged: Gemini expects alternating turns.
    if (last && last.role === role) last.parts.push(...parts);
    else contents.push({ role, parts });
  };

  let lastCalls: LlmToolCall[] = [];
  for (const msg of messages) {
    if (msg.role === "user") {
      push("user", [{ text: msg.text }]);
    } else if (msg.role === "assistant") {
      lastCalls = msg.toolCalls ?? [];
      const parts: Record<string, unknown>[] = [];
      if (msg.text) parts.push({ text: msg.text });
      for (const call of lastCalls) {
        const state = zCallState.safeParse(call.providerState ?? {});
        const meta = state.success ? state.data : {};
        parts.push({
          functionCall: {
            ...(meta.providerCallId ? { id: meta.providerCallId } : {}),
            name: call.name,
            args: call.args,
          },
          ...(meta.thoughtSignature ? { thoughtSignature: meta.thoughtSignature } : {}),
        });
      }
      push("model", parts);
    } else {
      const parts = msg.results.map((r) => {
        const original = lastCalls.find((c) => c.id === r.callId);
        const state = zCallState.safeParse(original?.providerState ?? {});
        const providerCallId = state.success ? state.data.providerCallId : undefined;
        return {
          functionResponse: {
            ...(providerCallId ? { id: providerCallId } : {}),
            name: r.name,
            response: r.isError ? { error: r.content } : { result: r.content },
          },
        };
      });
      push("user", parts);
    }
  }
  return contents;
}

// ---------------------------------------------------------------------------
// Batch response (Batch API, ai.google.dev/gemini-api/docs/batch-api)
// ---------------------------------------------------------------------------

const zInlinedResponse = z.object({
  metadata: z.object({ key: z.string().optional() }).optional(),
  response: zGeminiGenerateContentResponse.optional(),
  error: z.unknown().optional(),
});
const zInlinedList = z.union([
  z.array(zInlinedResponse),
  z.object({ inlinedResponses: z.array(zInlinedResponse) }),
]);
const zBatchJob = z.object({
  name: z.string().optional(),
  done: z.boolean().optional(),
  state: z.string().optional(),
  metadata: z.object({ state: z.string().optional() }).optional(),
  error: z.object({ message: z.string().optional() }).optional(),
  response: z
    .object({ inlinedResponses: zInlinedList.optional(), responsesFile: z.string().optional() })
    .optional(),
  output: z
    .object({ inlinedResponses: zInlinedList.optional(), responsesFile: z.string().optional() })
    .optional(),
});

const BATCH_ID = /^batches\/[A-Za-z0-9_-]+$/;
export const GEMINI_BATCH_ID_PATTERN = BATCH_ID;

export function createGeminiClient(config: GeminiClientConfig): LlmClient {
  const baseUrl = config.baseUrl ?? GEMINI_BASE_URL;
  const headroom = config.thinkingHeadroomTokens ?? GEMINI_DEFAULT_THINKING_HEADROOM_TOKENS;
  const modelFor = (tier: LlmTier): string =>
    bareModelId(config.models?.[tier] ?? GEMINI_DEFAULT_MODEL);
  const headers = { "x-goog-api-key": config.apiKey, "content-type": "application/json" };
  let callSeq = 0;

  const safetySettings = config.safetyThreshold
    ? SAFETY_CATEGORIES.map((category) => ({ category, threshold: config.safetyThreshold }))
    : undefined;

  const modelOf = (req: { model?: string | undefined; tier?: LlmTier | undefined }): string =>
    bareModelId(req.model ?? modelFor(req.tier ?? "fast"));

  function baseBody(
    model: string,
    req: { system?: string | undefined; maxOutputTokens: number; temperature?: number | undefined },
    extraConfig: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      ...(req.system ? { systemInstruction: { parts: [{ text: req.system }] } } : {}),
      generationConfig: {
        maxOutputTokens: req.maxOutputTokens + headroom,
        // Gemini 3+: Google "strongly recommend[s] keeping the temperature parameter at
        // its default value of 1.0" (looping/degraded output below it) — never sent there.
        ...(req.temperature !== undefined && !keepsDefaultTemperature(model)
          ? { temperature: req.temperature }
          : {}),
        ...extraConfig,
      },
      ...(safetySettings ? { safetySettings } : {}),
    };
  }

  async function generate(
    req: LlmTextRequest | LlmJsonRequest | LlmChatRequest,
    body: Record<string, unknown>,
  ): Promise<LlmResult<{ body: GeminiGenerateContentResponse; model: string }>> {
    const model = modelOf(req);
    const res = await requestJson({
      transport: config.transport,
      url: `${baseUrl}/v1beta/${modelPath(model)}:generateContent`,
      headers,
      body,
      timeoutMs: req.timeoutMs,
      maxRetries: req.maxRetries,
      totalTimeoutMs: req.totalTimeoutMs,
      classify: classifyGeminiError,
    });
    if (!res.ok) return { ok: false, error: res.error };
    const parsed = zGeminiGenerateContentResponse.safeParse(res.json);
    if (!parsed.success) {
      return llmFailure("bad_response", res.status, "response did not match the documented shape");
    }
    return { ok: true, body: parsed.data, model };
  }

  /** Blocked / empty-candidate handling shared by every call shape. */
  function checkCandidate(
    body: GeminiGenerateContentResponse,
  ): { ok: true; candidate: z.infer<typeof zCandidate> } | { ok: false; error: LlmError } {
    const blockReason = body.promptFeedback?.blockReason;
    if (blockReason) {
      return llmFailure("blocked", 200, `prompt blocked: ${blockReason}`);
    }
    const candidate = body.candidates?.[0];
    if (!candidate) return llmFailure("bad_response", 200, "no candidates in response");
    const finish = candidate.finishReason;
    if (finish && BLOCKED_FINISH_REASONS.has(finish)) {
      return llmFailure("blocked", 200, `response blocked: ${finish}`);
    }
    if (finish === "MALFORMED_FUNCTION_CALL" || finish === "UNEXPECTED_TOOL_CALL") {
      return llmFailure("bad_response", 200, `model produced an invalid tool call: ${finish}`);
    }
    if (finish === "MISSING_THOUGHT_SIGNATURE") {
      return llmFailure("invalid_request", 200, "request is missing a thought signature");
    }
    return { ok: true, candidate };
  }

  function visibleText(candidate: z.infer<typeof zCandidate>): string {
    return (candidate.content?.parts ?? [])
      .filter((p) => !p.thought && typeof p.text === "string")
      .map((p) => p.text as string)
      .join("")
      .trim();
  }

  async function generateText(req: LlmTextRequest): Promise<LlmResult<LlmTextResponse>> {
    const badMedia = unsupportedMediaType(req.input);
    if (badMedia) return llmFailure("invalid_request", 0, `unsupported media type: ${badMedia}`);
    const result = await generate(req, {
      contents: [{ role: "user", parts: toGeminiParts(toInputParts(req.input)) }],
      ...baseBody(modelOf(req), req),
    });
    if (!result.ok) return result;
    const checked = checkCandidate(result.body);
    if (!checked.ok) return checked;
    const text = visibleText(checked.candidate);
    const truncated = checked.candidate.finishReason === "MAX_TOKENS";
    if (!text) {
      return truncated
        ? llmFailure("truncated", 200, "output hit the token cap before any text")
        : llmFailure("bad_response", 200, "empty text response");
    }
    return {
      ok: true,
      text,
      finishReason: truncated ? "length" : "stop",
      usage: usageOf(result.body),
      model: result.model,
    };
  }

  async function generateJson(req: LlmJsonRequest): Promise<LlmResult<LlmJsonResponse>> {
    const badMedia = unsupportedMediaType(req.input);
    if (badMedia) return llmFailure("invalid_request", 0, `unsupported media type: ${badMedia}`);
    const result = await generate(req, {
      contents: [{ role: "user", parts: toGeminiParts(toInputParts(req.input)) }],
      ...baseBody(modelOf(req), req, {
        responseMimeType: "application/json",
        responseJsonSchema: req.schema,
      }),
    });
    if (!result.ok) return result;
    const checked = checkCandidate(result.body);
    if (!checked.ok) return checked;
    const text = visibleText(checked.candidate);
    if (!text) {
      return checked.candidate.finishReason === "MAX_TOKENS"
        ? llmFailure("truncated", 200, "output hit the token cap before any JSON")
        : llmFailure("bad_response", 200, "empty JSON response");
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      try {
        json = extractJsonObject(text);
      } catch {
        return checked.candidate.finishReason === "MAX_TOKENS"
          ? llmFailure("truncated", 200, "JSON output was cut off at the token cap")
          : llmFailure("bad_response", 200, "response text was not valid JSON");
      }
    }
    return { ok: true, json, text, usage: usageOf(result.body), model: result.model };
  }

  async function chat(req: LlmChatRequest): Promise<LlmResult<LlmChatResponse>> {
    const result = await generate(req, {
      contents: toGeminiContents(req.messages),
      ...(req.tools && req.tools.length > 0
        ? {
            tools: [
              {
                functionDeclarations: req.tools.map((t) => ({
                  name: t.name,
                  description: t.description,
                  parametersJsonSchema: t.inputSchema,
                })),
              },
            ],
          }
        : {}),
      ...baseBody(modelOf(req), req),
    });
    if (!result.ok) return result;
    const checked = checkCandidate(result.body);
    if (!checked.ok) return checked;
    const parts = checked.candidate.content?.parts ?? [];
    const toolCalls = toolCallsFromParts(parts, `gemini-call-${++callSeq}`);
    const text = visibleText(checked.candidate);
    if (toolCalls.length === 0 && !text) {
      return checked.candidate.finishReason === "MAX_TOKENS"
        ? llmFailure("truncated", 200, "output hit the token cap before any text")
        : llmFailure("bad_response", 200, "empty chat response");
    }
    const stopReason: LlmChatResponse["stopReason"] =
      toolCalls.length > 0
        ? "tool_use"
        : checked.candidate.finishReason === "MAX_TOKENS"
          ? "max_tokens"
          : "end_turn";
    return {
      ok: true,
      text,
      toolCalls,
      stopReason,
      assistantMessage: {
        role: "assistant",
        ...(text ? { text } : {}),
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
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
        url: `${baseUrl}/v1beta/${modelPath(useModel)}:batchGenerateContent`,
        headers,
        body: {
          batch: {
            display_name: `heyloo-${new Date().toISOString()}`,
            input_config: {
              requests: {
                requests: requests.map((r: LlmBatchRequestItem) => ({
                  request: {
                    contents: [{ role: "user", parts: [{ text: r.input }] }],
                    ...baseBody(useModel, { system: r.system, maxOutputTokens: r.maxOutputTokens }),
                  },
                  metadata: { key: r.key },
                })),
              },
            },
          },
        },
        classify: classifyGeminiError,
      });
      if (!res.ok) return { ok: false, error: res.error };
      const name = z.object({ name: z.string() }).safeParse(res.json);
      if (!name.success || !BATCH_ID.test(name.data.name)) {
        return llmFailure("bad_response", res.status, "batch create response had no batch name");
      }
      return { ok: true, batchId: name.data.name };
    },

    async get(batchId) {
      if (!BATCH_ID.test(batchId)) {
        return llmFailure("invalid_request", 0, "not a Gemini batch id");
      }
      const res = await requestJson({
        transport: config.transport,
        url: `${baseUrl}/v1beta/${batchId}`,
        method: "GET",
        headers: { "x-goog-api-key": config.apiKey },
        classify: classifyGeminiError,
      });
      if (!res.ok) return { ok: false, error: res.error };
      const parsed = zBatchJob.safeParse(res.json);
      if (!parsed.success) {
        return llmFailure(
          "bad_response",
          res.status,
          "batch status did not match the documented shape",
        );
      }
      const job = parsed.data;
      const state = (job.metadata?.state ?? job.state ?? "").toUpperCase();
      let status: LlmBatchStatus;
      if (/FAILED|CANCELLED|EXPIRED/.test(state) || job.error) {
        status = { state: "failed", reason: job.error?.message ?? (state || "failed") };
      } else if (/SUCCEEDED/.test(state) || (job.done === true && (job.response || job.output))) {
        const out = job.response ?? job.output;
        const list = out?.inlinedResponses;
        const items = Array.isArray(list) ? list : (list?.inlinedResponses ?? []);
        if (!list && out?.responsesFile) {
          return llmFailure(
            "bad_response",
            res.status,
            "batch results were returned as a file; only inline results are supported",
          );
        }
        const results: LlmBatchResultItem[] = [];
        for (const item of items) {
          const key = item.metadata?.key;
          if (!key) continue;
          const candidate = item.response
            ? checkCandidate(item.response)
            : { ok: false as const, error: undefined };
          results.push({
            key,
            text: candidate.ok ? visibleText(candidate.candidate) || null : null,
          });
        }
        status = { state: "succeeded", results };
      } else {
        status = { state: "in_progress" };
      }
      return { ok: true, status };
    },
  };

  return { provider: "gemini", modelFor, generateText, generateJson, chat, batch };
}
