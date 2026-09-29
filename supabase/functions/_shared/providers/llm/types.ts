/**
 * LLM provider port (docs/design/LLM_PROVIDERS.md, task LLM-1).
 *
 * Every LLM vendor is one adapter file in this directory (`gemini.ts`,
 * `anthropic.ts`) implementing `LlmClient`. Core code — the text-agent
 * engine, menu import, demo scrape, outreach personalization / scoring /
 * reply classification — depends ONLY on the canonical types below and never
 * on a vendor field name, header, or payload shape (CLAUDE.md Rule 2).
 * Switching vendor is a config change: `LLM_PROVIDER` (`gemini` | `anthropic`).
 *
 * Three call shapes cover every feature:
 *   - `generateText`  — free text out (research summary, opening line).
 *   - `generateJson`  — structured extraction: a JSON Schema in, a parsed JSON
 *                       value out; input may include image/PDF bytes (menu
 *                       photo/PDF import). The CALLER still zod-validates the
 *                       value — a provider's schema mode is best-effort.
 *   - `chat`          — multi-turn conversation with tool calling (the SMS /
 *                       web-chat text agent).
 * plus a bulk-async `batch` API for the outreach research pass.
 *
 * Nothing here throws for a provider/network failure: every method resolves to
 * `LlmResult`, whose failure arm carries a classified `LlmError`.
 */

export const LLM_PROVIDER_IDS = ["gemini", "anthropic"] as const;
export type LlmProviderId = (typeof LLM_PROVIDER_IDS)[number];

export function isLlmProviderId(value: unknown): value is LlmProviderId {
  return typeof value === "string" && (LLM_PROVIDER_IDS as readonly string[]).includes(value);
}

/**
 * Which model class a call wants; each adapter maps a tier to a concrete model
 * id from env (Gemini: `GEMINI_MODEL` / `GEMINI_MODEL_QUALITY` /
 * `GEMINI_MODEL_VISION`). Call sites never name a vendor model.
 *   - `fast`    extraction, classification, summarization (default)
 *   - `quality` customer-facing generation and tool calling (text agent, hooks)
 *   - `vision`  reads image/PDF bytes (menu import)
 */
export const LLM_TIERS = ["fast", "quality", "vision"] as const;
export type LlmTier = (typeof LLM_TIERS)[number];

export type LlmFetch = (input: string, init?: RequestInit) => Promise<Response>;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const LLM_ERROR_KINDS = [
  /** 401/403 — bad key, key without access, API not enabled. Operator action. */
  "auth",
  /** 402 — prepaid credit depleted / billing problem. Operator action. */
  "payment",
  /** 429 — per-minute limit or quota. Retryable with backoff. */
  "rate_limited",
  /** 400/404/422 — malformed request, unknown model id. Never retryable. */
  "invalid_request",
  /** The provider's safety layer refused the prompt or the answer. */
  "blocked",
  /** The output hit the token cap before producing usable content. */
  "truncated",
  /** The attempt exceeded its time budget. Retryable. */
  "timeout",
  /** 5xx / network error. Retryable. */
  "unavailable",
  /** 2xx but empty, unparseable, or not the documented shape. */
  "bad_response",
] as const;
export type LlmErrorKind = (typeof LLM_ERROR_KINDS)[number];

export interface LlmError {
  kind: LlmErrorKind;
  /** HTTP status, or 0 for a transport failure / timeout. */
  status: number;
  /** Short, provider-supplied detail for logs. Never contains a credential. */
  message: string;
  retryable: boolean;
}

export type LlmResult<T> = ({ ok: true } & T) | { ok: false; error: LlmError };

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

export type LlmContentPart =
  | { kind: "text"; text: string }
  /** Inline image or PDF bytes (base64, no `data:` prefix). */
  | { kind: "media"; mimeType: string; dataBase64: string };

export type LlmInput = string | LlmContentPart[];

/** Plain JSON Schema (draft-07-ish; the vendor-supported subset — see the
 * docs). The top level must be an object schema. */
export type LlmJsonSchema = Record<string, unknown>;

export interface LlmUsage {
  inputTokens: number;
  /** Everything billed as output, including reasoning ("thinking") tokens. */
  outputTokens: number;
}

interface LlmRequestBase {
  /** Default `fast`. */
  tier?: LlmTier;
  /** Exact model id, overriding the tier's configured one (tests, experiments). */
  model?: string;
  system?: string;
  /** Cap on the visible answer; adapters add headroom for reasoning tokens. */
  maxOutputTokens: number;
  temperature?: number;
  /** Per-attempt time budget. Default 20s. */
  timeoutMs?: number;
  /** Retries after the first attempt on 408/429/5xx/network/timeout. Default 2. */
  maxRetries?: number;
}

export interface LlmTextRequest extends LlmRequestBase {
  input: LlmInput;
}

export interface LlmJsonRequest extends LlmRequestBase {
  input: LlmInput;
  schema: LlmJsonSchema;
}

export interface LlmToolDef {
  name: string;
  description: string;
  /** JSON Schema object describing the tool arguments. */
  inputSchema: LlmJsonSchema;
}

export interface LlmToolCall {
  /** Stable id used to pair a result with its call. */
  id: string;
  name: string;
  args: Record<string, unknown>;
  /** Opaque adapter state (for example a reasoning signature the vendor
   * requires echoed back with the call). Core code stores and returns it
   * untouched. */
  providerState?: unknown;
}

export interface LlmToolResult {
  callId: string;
  /** The tool's name (some vendors pair results by name). */
  name: string;
  content: string;
  isError?: boolean;
}

export type LlmMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; text?: string; toolCalls?: LlmToolCall[] }
  | { role: "tool"; results: LlmToolResult[] };

export interface LlmChatRequest extends LlmRequestBase {
  messages: LlmMessage[];
  tools?: LlmToolDef[];
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export interface LlmTextResponse {
  text: string;
  /** `length` = stopped at the token cap; the text may be cut short. */
  finishReason: "stop" | "length";
  usage: LlmUsage;
  model: string;
}

export interface LlmJsonResponse {
  /** The parsed JSON value — NOT yet validated by the caller's schema. */
  json: unknown;
  text: string;
  usage: LlmUsage;
  model: string;
}

export interface LlmChatResponse {
  /** Concatenated visible text (may accompany tool calls). */
  text: string;
  toolCalls: LlmToolCall[];
  stopReason: "end_turn" | "tool_use" | "max_tokens";
  /** Append this to `messages` before sending the tool results back. */
  assistantMessage: Extract<LlmMessage, { role: "assistant" }>;
  usage: LlmUsage;
  model: string;
}

// ---------------------------------------------------------------------------
// Batch (bulk, asynchronous, discounted) — text-only requests
// ---------------------------------------------------------------------------

export interface LlmBatchRequestItem {
  /** Echoed back on the matching result; callers set it to a row id. */
  key: string;
  input: string;
  system?: string;
  maxOutputTokens: number;
}

export type LlmBatchState = "in_progress" | "succeeded" | "failed";

export interface LlmBatchResultItem {
  key: string;
  /** null for an item the provider errored, expired, blocked, or cancelled. */
  text: string | null;
}

export type LlmBatchStatus =
  | { state: "in_progress" }
  | { state: "succeeded"; results: LlmBatchResultItem[] }
  /** The whole batch failed / expired / was cancelled: no results exist. */
  | { state: "failed"; reason: string };

export interface LlmBatchApi {
  submit(input: {
    tier?: LlmTier;
    model?: string;
    requests: LlmBatchRequestItem[];
  }): Promise<LlmResult<{ batchId: string }>>;
  get(batchId: string): Promise<LlmResult<{ status: LlmBatchStatus }>>;
}

// ---------------------------------------------------------------------------
// The port
// ---------------------------------------------------------------------------

export interface LlmClient {
  readonly provider: LlmProviderId;
  /** The concrete model id a tier resolves to (for cost accounting/logs). */
  modelFor(tier: LlmTier): string;
  generateText(req: LlmTextRequest): Promise<LlmResult<LlmTextResponse>>;
  generateJson(req: LlmJsonRequest): Promise<LlmResult<LlmJsonResponse>>;
  chat(req: LlmChatRequest): Promise<LlmResult<LlmChatResponse>>;
  readonly batch: LlmBatchApi;
}

/** What an LLM-backed feature reports when no provider is usable, so the
 * portal / owner can see an actionable "AI not configured" state. */
export interface LlmNotConfigured {
  reason: "not_configured" | "unknown_provider";
  /** The provider that was selected (or the unrecognized value). */
  providerId: string;
  /** Env var names to set, e.g. `["GEMINI_API_KEY"]`. */
  missing: readonly string[];
}

export type LlmResolution = { ok: true; client: LlmClient } | ({ ok: false } & LlmNotConfigured);

export function llmFailure(
  kind: LlmErrorKind,
  status: number,
  message: string,
  retryable = false,
): { ok: false; error: LlmError } {
  return { ok: false, error: { kind, status, message: message.slice(0, 500), retryable } };
}

export function toInputParts(input: LlmInput): LlmContentPart[] {
  return typeof input === "string" ? [{ kind: "text", text: input }] : input;
}
