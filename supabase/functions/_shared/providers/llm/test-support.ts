import type {
  LlmBatchApi,
  LlmChatRequest,
  LlmChatResponse,
  LlmClient,
  LlmJsonRequest,
  LlmJsonResponse,
  LlmProviderId,
  LlmResult,
  LlmTextRequest,
  LlmTextResponse,
  LlmTier,
  LlmUsage,
} from "./types.ts";
import { llmFailure } from "./types.ts";

/**
 * Port-level test double for call-site tests: a handler under test depends on
 * `LlmClient`, so its tests script the canonical responses directly and never
 * build a vendor payload. Test-only — never imported by production code.
 */

export const ZERO_USAGE: LlmUsage = { inputTokens: 1, outputTokens: 1 };

export interface FakeLlm extends LlmClient {
  readonly calls: {
    text: LlmTextRequest[];
    json: LlmJsonRequest[];
    chat: LlmChatRequest[];
  };
}

type Maybe<T> = T | Promise<T>;

export interface FakeLlmScript {
  provider?: LlmProviderId;
  text?: (req: LlmTextRequest) => Maybe<LlmResult<LlmTextResponse>>;
  json?: (req: LlmJsonRequest) => Maybe<LlmResult<LlmJsonResponse>>;
  chat?: (req: LlmChatRequest) => Maybe<LlmResult<LlmChatResponse>>;
  batch?: Partial<LlmBatchApi>;
}

const unscripted = () => llmFailure("unavailable", 0, "fake LLM: call not scripted");

export function fakeLlm(script: FakeLlmScript = {}): FakeLlm {
  const calls: FakeLlm["calls"] = { text: [], json: [], chat: [] };
  return {
    provider: script.provider ?? "gemini",
    calls,
    modelFor: (tier: LlmTier) => `fake-${tier}`,
    async generateText(req) {
      calls.text.push(req);
      return script.text ? script.text(req) : unscripted();
    },
    async generateJson(req) {
      calls.json.push(req);
      return script.json ? script.json(req) : unscripted();
    },
    async chat(req) {
      calls.chat.push(req);
      return script.chat ? script.chat(req) : unscripted();
    },
    batch: {
      submit: script.batch?.submit ?? (async () => unscripted()),
      get: script.batch?.get ?? (async () => unscripted()),
    },
  };
}

export function textOk(text: string): LlmResult<LlmTextResponse> {
  return { ok: true, text, finishReason: "stop", usage: ZERO_USAGE, model: "fake-fast" };
}

export function jsonOk(json: unknown): LlmResult<LlmJsonResponse> {
  return { ok: true, json, text: JSON.stringify(json), usage: ZERO_USAGE, model: "fake-fast" };
}

export function chatText(text: string, usage: LlmUsage = ZERO_USAGE): LlmResult<LlmChatResponse> {
  return {
    ok: true,
    text,
    toolCalls: [],
    stopReason: "end_turn",
    assistantMessage: { role: "assistant", text },
    usage,
    model: "fake-quality",
  };
}

export function chatToolCall(
  name: string,
  args: Record<string, unknown>,
  id = "call_1",
  usage: LlmUsage = ZERO_USAGE,
): LlmResult<LlmChatResponse> {
  const toolCalls = [{ id, name, args }];
  return {
    ok: true,
    text: "",
    toolCalls,
    stopReason: "tool_use",
    assistantMessage: { role: "assistant", toolCalls },
    usage,
    model: "fake-quality",
  };
}
