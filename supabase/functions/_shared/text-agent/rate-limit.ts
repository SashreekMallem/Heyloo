import type { Clock } from "../types.ts";
import { systemClock } from "../types.ts";

/**
 * Per-phone (or per-widget-session) sliding-window rate limiter for the
 * text-agent engine ("rate limiting per phone" — this task's own
 * requirement). Same in-process, module-scope, per-warm-instance shape as
 * `_shared/circuit-breaker.ts`'s `ToolCircuitBreaker` (that file's own
 * docstring: "no synchronous shared-counter read on the hot path") — a
 * cross-instance-exact limit isn't needed here, only a cheap backstop
 * against a runaway/abusive sender hammering the Anthropic API through one
 * tenant's number.
 */

interface Bucket {
  hits: number[]; // timestamps (ms), within the current window only
}

export interface RateLimiterOptions {
  /** Rolling window length, ms. Default 60s. */
  windowMs?: number;
  /** Max messages allowed in the window before further ones are dropped.
   * Default 8 — generous for a real back-and-forth conversation, tight
   * enough to stop a scripted flood. */
  maxPerWindow?: number;
  clock?: Clock;
}

const DEFAULTS: Required<RateLimiterOptions> = {
  windowMs: 60_000,
  maxPerWindow: 8,
  clock: systemClock,
};

export class TextAgentRateLimiter {
  private readonly opts: Required<RateLimiterOptions>;
  private readonly buckets = new Map<string, Bucket>();

  constructor(opts: RateLimiterOptions = {}) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  /** Records this message and returns whether it's within budget. Always
   * records (even a denied hit counts) so a sustained flood doesn't reset
   * itself into "allowed" every window boundary via a check-without-record
   * race. */
  allow(key: string): boolean {
    const now = this.opts.clock().getTime();
    const cutoff = now - this.opts.windowMs;
    const bucket = this.buckets.get(key) ?? { hits: [] };
    bucket.hits = bucket.hits.filter((ts) => ts > cutoff);
    const withinBudget = bucket.hits.length < this.opts.maxPerWindow;
    bucket.hits.push(now);
    this.buckets.set(key, bucket);
    return withinBudget;
  }
}

/** One instance per warm Edge Function instance, same convention as
 * `voice-tools/index.ts`'s module-scope `ToolCircuitBreaker` — constructed
 * once at module load, reused across invocations on that instance. */
export const textAgentRateLimiter = new TextAgentRateLimiter();

/**
 * Independent cap on `verify_phone` (`tool-router.ts`) — every call is a
 * REAL SMS send to an arbitrary number the customer types in, not just
 * another rate-limited message, so it needs its own budget rather than
 * riding on `textAgentRateLimiter`'s general per-session message cap
 * (docs/BUILD_NOTES.md, repair task). Deliberately keyed on `tenantId`
 * alone (never a conversation id or session key) so the cap holds even
 * across many independently-rate-limited or freshly-minted web_chat
 * sessions/conversations — otherwise an attacker who can mint fresh
 * sessions faster than the per-session limiter resets could still use
 * `verify_phone` as an open SMS-bombing relay against arbitrary third-party
 * numbers. 20/hour per tenant is generous for real verification traffic
 * (a handful of customers verifying once per conversation) and tight
 * enough to stop a scripted flood. */
export const verifyPhoneRateLimiter = new TextAgentRateLimiter({
  windowMs: 60 * 60 * 1000,
  maxPerWindow: 20,
});
