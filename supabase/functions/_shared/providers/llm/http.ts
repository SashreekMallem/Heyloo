import type { LlmError, LlmFetch } from "./types.ts";

/**
 * Shared transport for the LLM adapters: one JSON request with a per-attempt
 * timeout and bounded retries with exponential backoff + jitter on transient
 * failures (408 / 429 / 5xx / network / timeout). Vendor-specific error
 * classification is injected (`classify`), so this file knows no vendor.
 * Retry policy follows Google's own guidance for the Gemini API
 * (ai.google.dev/gemini-api/docs/troubleshooting: exponential backoff with
 * jitter, retry only on 429/408/5xx, never on 400/402/403, cap the attempts).
 */

export const DEFAULT_TIMEOUT_MS = 20_000;
export const DEFAULT_MAX_RETRIES = 2;
const BACKOFF_BASE_MS = 500;
const BACKOFF_CAP_MS = 4_000;
const RETRY_AFTER_CAP_MS = 5_000;

export interface LlmTransport {
  fetchImpl: LlmFetch;
  /** Injectable so tests never wait on a real timer. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable jitter source (0..1). */
  random?: () => number;
}

export interface JsonRequestOptions {
  transport: LlmTransport;
  url: string;
  method?: "GET" | "POST";
  headers: Record<string, string>;
  body?: unknown;
  timeoutMs?: number | undefined;
  maxRetries?: number | undefined;
  /** `text` skips JSON parsing (for JSONL result downloads). Default `json`. */
  responseType?: "json" | "text";
  /** Turns a non-2xx response into a classified error. */
  classify: (status: number, bodyText: string) => LlmError;
}

export type JsonRequestResult =
  | { ok: true; status: number; json: unknown; text: string }
  | { ok: false; error: LlmError };

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function retryAfterMs(res: Response): number | undefined {
  const raw = res.headers.get("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return Math.min(seconds * 1000, RETRY_AFTER_CAP_MS);
}

/** Status-only fallback classification shared by both adapters. */
export function classifyStatus(status: number, message: string): LlmError {
  if (status === 401 || status === 403) return { kind: "auth", status, message, retryable: false };
  if (status === 402) return { kind: "payment", status, message, retryable: false };
  if (status === 429) return { kind: "rate_limited", status, message, retryable: true };
  if (status === 408) return { kind: "timeout", status, message, retryable: true };
  if (status >= 500) return { kind: "unavailable", status, message, retryable: status !== 501 };
  return { kind: "invalid_request", status, message, retryable: false };
}

/** Pulls a short message out of a JSON error body, whatever the vendor's
 * envelope: `{error:{message}}`, `{error:"text"}`, `{message}`. */
export function extractErrorMessage(bodyText: string): string {
  try {
    const parsed = JSON.parse(bodyText) as unknown;
    if (parsed && typeof parsed === "object") {
      const rec = parsed as Record<string, unknown>;
      const err = rec["error"];
      if (typeof err === "string") return err;
      if (err && typeof err === "object") {
        const message = (err as Record<string, unknown>)["message"];
        if (typeof message === "string") return message;
      }
      if (typeof rec["message"] === "string") return rec["message"];
    }
  } catch {
    // not JSON — fall through to the raw text
  }
  return bodyText.slice(0, 300);
}

export async function requestJson(opts: JsonRequestOptions): Promise<JsonRequestResult> {
  const sleep = opts.transport.sleep ?? defaultSleep;
  const random = opts.transport.random ?? Math.random;
  const maxRetries = Math.max(0, opts.maxRetries ?? DEFAULT_MAX_RETRIES);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let last: LlmError = {
    kind: "unavailable",
    status: 0,
    message: "no attempt made",
    retryable: false,
  };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let waitHintMs: number | undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await opts.transport.fetchImpl(opts.url, {
        method: opts.method ?? "POST",
        headers: opts.headers,
        ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
        signal: controller.signal,
      });
      const text = await res.text();
      if (res.ok) {
        if (opts.responseType === "text") return { ok: true, status: res.status, json: null, text };
        try {
          return { ok: true, status: res.status, json: JSON.parse(text), text };
        } catch {
          return {
            ok: false,
            error: {
              kind: "bad_response",
              status: res.status,
              message: "response body was not JSON",
              retryable: false,
            },
          };
        }
      }
      last = opts.classify(res.status, text);
      waitHintMs = retryAfterMs(res);
    } catch (err) {
      const aborted = controller.signal.aborted;
      last = {
        kind: aborted ? "timeout" : "unavailable",
        status: 0,
        message: aborted
          ? `attempt exceeded ${timeoutMs}ms`
          : err instanceof Error
            ? err.message
            : String(err),
        retryable: true,
      };
    } finally {
      clearTimeout(timer);
    }

    if (!last.retryable || attempt === maxRetries) break;
    const backoff = Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_CAP_MS);
    await sleep(waitHintMs ?? backoff + Math.floor(random() * 250));
  }

  return { ok: false, error: last };
}
