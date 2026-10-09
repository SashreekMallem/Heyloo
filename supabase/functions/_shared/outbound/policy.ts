import { SafeFetchError } from "../safe-fetch.ts";

/**
 * OUTBOUND-1 delivery policy: what counts as delivered, when to retry, when
 * to give up. Pure (no I/O) so the whole schedule is unit tested.
 *
 * Standard Webhooks (spec/standard-webhooks.md, "Delivery success and
 * failure"): 2xx is success; 3xx is a failure (we never follow redirects);
 * 410 Gone means disable the endpoint and stop sending; everything else
 * (other 4xx/5xx, timeouts, connection errors) is a failure to retry;
 * `retry-after` should be taken into account.
 *
 * Schedule (docs design OUTBOUND-1): after failed attempt n (1-based) wait
 * 1 min, 5 min, 30 min, 2 h, 5 h, 10 h, 24 h, each with +/-10% jitter;
 * attempt 8 failing is final (about 42 h after the first). A `Retry-After`
 * (seconds or HTTP date) is honored as a floor, capped at 24 h.
 */

export const WEBHOOK_MAX_ATTEMPTS = 8;

/** Wait after failed attempt n is `WEBHOOK_BACKOFF_SECONDS[n - 1]`. */
export const WEBHOOK_BACKOFF_SECONDS: readonly number[] = [
  60,
  5 * 60,
  30 * 60,
  2 * 60 * 60,
  5 * 60 * 60,
  10 * 60 * 60,
  24 * 60 * 60,
];

export const WEBHOOK_RETRY_AFTER_CAP_SECONDS = 24 * 60 * 60;
export const WEBHOOK_JITTER_RATIO = 0.1;

/** Per-attempt deadline (DNS + connect + response headers). */
export const WEBHOOK_REQUEST_TIMEOUT_MS = 5_000;

/** Short owner-safe text stored in `last_error` (never a raw exception message). */
const MAX_ERROR_LENGTH = 200;

export type AttemptOutcome =
  | { kind: "delivered"; statusCode: number }
  | { kind: "gone"; statusCode: 410; error: string }
  | { kind: "retry"; statusCode: number | null; error: string; retryAfterSeconds: number | null };

/** Jittered wait (whole seconds) after failed attempt `attempt`, or null when it was the last one. */
export function backoffSeconds(attempt: number, random: () => number = Math.random): number | null {
  if (!Number.isInteger(attempt) || attempt < 1 || attempt >= WEBHOOK_MAX_ATTEMPTS) return null;
  const base = WEBHOOK_BACKOFF_SECONDS[attempt - 1];
  if (base === undefined) return null;
  const factor = 1 + (random() * 2 - 1) * WEBHOOK_JITTER_RATIO;
  return Math.max(1, Math.round(base * factor));
}

/**
 * `Retry-After` as whole seconds from `now` (RFC 9110 §10.2.3: a
 * non-negative integer of seconds, or an HTTP-date). Null when absent or
 * unparseable; 0 for a date in the past; capped at 24 h.
 */
export function parseRetryAfter(header: string | null | undefined, now: Date): number | null {
  const value = header?.trim();
  if (!value) return null;
  if (/^\d+$/.test(value)) {
    return Math.min(Number(value), WEBHOOK_RETRY_AFTER_CAP_SECONDS);
  }
  // HTTP-date must name a weekday and GMT (IMF-fixdate); also accepts the
  // obsolete RFC 850 / asctime forms Date.parse understands. A bare number
  // with a sign or decimals is not valid Retry-After and is ignored.
  if (!/[a-z]/i.test(value)) return null;
  const at = Date.parse(value);
  if (Number.isNaN(at)) return null;
  const seconds = Math.ceil((at - now.getTime()) / 1000);
  return Math.min(Math.max(seconds, 0), WEBHOOK_RETRY_AFTER_CAP_SECONDS);
}

/**
 * Seconds to wait before the next attempt after `attempt` failed, or null
 * when no attempt is left. Never sooner than our own schedule (a
 * `Retry-After: 0` cannot make us hammer a struggling receiver), never
 * sooner than the receiver asked, never more than 24 h.
 */
export function nextRetryDelaySeconds(
  attempt: number,
  retryAfterSeconds: number | null,
  random: () => number = Math.random,
): number | null {
  const backoff = backoffSeconds(attempt, random);
  if (backoff === null) return null;
  return Math.min(Math.max(backoff, retryAfterSeconds ?? 0), WEBHOOK_RETRY_AFTER_CAP_SECONDS);
}

function clip(text: string): string {
  return text.length > MAX_ERROR_LENGTH ? `${text.slice(0, MAX_ERROR_LENGTH - 1)}…` : text;
}

/** Classifies the receiver's HTTP answer. */
export function classifyResponse(
  status: number,
  headers: { get(name: string): string | null },
  now: Date,
): AttemptOutcome {
  if (status >= 200 && status <= 299) return { kind: "delivered", statusCode: status };
  if (status === 410) {
    return {
      kind: "gone",
      statusCode: 410,
      error: "HTTP 410: the receiving app said this address is gone",
    };
  }
  const label =
    status >= 300 && status <= 399
      ? `HTTP ${status}: the address redirects (use the final URL instead)`
      : status === 429
        ? "HTTP 429: the receiving app is rate limiting"
        : `HTTP ${status}`;
  return {
    kind: "retry",
    statusCode: status,
    error: clip(label),
    retryAfterSeconds: parseRetryAfter(headers.get("retry-after"), now),
  };
}

/** Classifies a failure to get any HTTP answer (safe-fetch policy, timeout, network). */
export function classifyError(
  err: unknown,
  timeoutMs: number = WEBHOOK_REQUEST_TIMEOUT_MS,
): AttemptOutcome {
  const retry = (error: string): AttemptOutcome => ({
    kind: "retry",
    statusCode: null,
    error: clip(error),
    retryAfterSeconds: null,
  });
  if (!(err instanceof SafeFetchError)) return retry("Could not connect");
  switch (err.code) {
    case "timeout":
      return retry(`Timed out after ${Math.round(timeoutMs / 1000)}s`);
    case "too_many_redirects":
    case "bad_redirect":
      return retry("The address redirects (use the final URL instead)");
    case "invalid_url":
    case "scheme_not_allowed":
    case "port_not_allowed":
    case "userinfo_not_allowed":
    case "ip_encoding_not_allowed":
    case "blocked_address":
    case "blocked_hostname":
      return retry("This address isn't allowed (it must be a public https:// address)");
    case "dns_failed":
      return retry("Could not find that web address");
    case "content_type_not_allowed":
    case "response_too_large":
      return retry("Unexpected response from the receiving app");
    case "network_error":
      return retry("Could not connect");
  }
  return retry("Could not connect");
}
