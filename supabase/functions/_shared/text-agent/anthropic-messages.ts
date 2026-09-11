/**
 * Tool-use-capable Anthropic Messages API client for the text-agent engine
 * (CLAUDE.md Rule 1: verified against the documented, stable Messages API
 * request/response envelope — same `POST /v1/messages` endpoint and
 * `anthropic-version` header `_shared/providers/anthropic.ts` already uses).
 * A separate, small client rather than extending that shared file: this
 * cluster's ownership is `_shared/text-agent/**` only (`_shared/providers/
 * anthropic.ts` is outside it), and the multi-turn/tool-use shape this
 * engine needs (a full `messages[]` array with `tool_use`/`tool_result`
 * content blocks, a `tools` array, `tool_choice`) is a materially different
 * contract from that file's single-user-message `createMessage` helper —
 * same "plain fetch, no `@anthropic-ai/sdk`" Deno-portability reasoning
 * that file's own docstring documents (this package cannot import a
 * pnpm-workspace Node package into a Deno-executed file without a bundling
 * step this codebase doesn't add).
 *
 * VERIFY (docs/VERIFY.md): the request/response envelope below (`messages`,
 * `tools[].input_schema`, `tool_use`/`tool_result` content blocks,
 * `stop_reason: "tool_use"`) is the long-stable, well-documented Messages
 * API tool-use contract — high confidence, not re-flagged to VERIFY.md
 * beyond the existing entry `_shared/providers/anthropic.ts` already logged
 * for the base envelope/model-id/version-header triple this file reuses
 * verbatim (`ANTHROPIC_MESSAGES_URL`, `ANTHROPIC_VERSION`).
 */

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export type AnthropicFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface AnthropicToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

export interface AnthropicMessagesRequest {
  model: string;
  maxTokens: number;
  system?: string;
  messages: AnthropicMessage[];
  tools?: AnthropicToolDef[];
  /** Bounded per-turn thinking budget — omitted by default (this engine's
   * SMS/web-chat latency budget has no room for extended thinking). */
  temperature?: number;
}

export interface AnthropicMessagesResponse {
  content: AnthropicContentBlock[];
  stop_reason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" | "pause_turn" | null;
  usage: { input_tokens: number; output_tokens: number };
}

export type AnthropicMessagesResult =
  | { ok: true; response: AnthropicMessagesResponse }
  | { ok: false; status: number; error?: string };

export async function createMessagesWithTools(
  fetchImpl: AnthropicFetch,
  apiKey: string,
  req: AnthropicMessagesRequest,
): Promise<AnthropicMessagesResult> {
  let res: Response;
  try {
    res = await fetchImpl(ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.maxTokens,
        ...(req.system ? { system: req.system } : {}),
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        messages: req.messages,
        ...(req.tools && req.tools.length > 0 ? { tools: req.tools } : {}),
      }),
    });
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => undefined);
    return { ok: false, status: res.status, ...(text !== undefined ? { error: text } : {}) };
  }

  const body = (await res.json().catch(() => undefined)) as
    | {
        content?: AnthropicContentBlock[];
        stop_reason?: AnthropicMessagesResponse["stop_reason"];
        usage?: { input_tokens: number; output_tokens: number };
      }
    | undefined;

  if (!body?.content) {
    return { ok: false, status: res.status, error: "empty_response" };
  }

  return {
    ok: true,
    response: {
      content: body.content,
      stop_reason: body.stop_reason ?? null,
      usage: body.usage ?? { input_tokens: 0, output_tokens: 0 },
    },
  };
}

/** Concatenates every `text` block in an assistant response — the reply
 * actually shown to the customer (tool_use blocks never reach them). */
export function extractReplyText(content: AnthropicContentBlock[]): string {
  return content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

export function extractToolUseBlocks(
  content: AnthropicContentBlock[],
): { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }[] {
  return content.filter(
    (b): b is { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } =>
      b.type === "tool_use",
  );
}
