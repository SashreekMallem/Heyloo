/**
 * Per-key sliding-window rate limiter for the widget's public, unauthenticated
 * routes (`/api/widget/session`, `/api/widget/voice-token`) — same
 * in-process, module-scope, per-warm-instance shape as
 * `supabase/functions/_shared/text-agent/rate-limit.ts`'s
 * `TextAgentRateLimiter` (deliberately mirrored rather than imported: that
 * file lives under `supabase/functions/**`, a separate Deno runtime/
 * TypeScript project apps/web's Next.js build doesn't compile against).
 * Backstop against a scripted flood hammering one tenant's widget origin
 * with session-mint or voice-token requests, not a precise distributed
 * limit — a warm serverless instance resets this on cold start, which is
 * an accepted, documented gap for the same reason the mirrored file
 * accepts it.
 */

interface Bucket {
  hits: number[];
}

export class SlidingWindowRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly windowMs = 60_000,
    private readonly maxPerWindow = 20,
    private readonly now: () => number = () => Date.now(),
  ) {}

  allow(key: string): boolean {
    const now = this.now();
    const cutoff = now - this.windowMs;
    const bucket = this.buckets.get(key) ?? { hits: [] };
    bucket.hits = bucket.hits.filter((ts) => ts > cutoff);
    const withinBudget = bucket.hits.length < this.maxPerWindow;
    bucket.hits.push(now);
    this.buckets.set(key, bucket);
    return withinBudget;
  }
}

/** One instance per warm serverless instance — module-scope, constructed
 * once. 20 requests/minute per (IP, widget_public_key) pair: generous for
 * a real visitor opening the widget and switching modes a few times,
 * tight enough to stop a scripted hammer. */
export const widgetSessionRateLimiter = new SlidingWindowRateLimiter(60_000, 20);

/** Widget voice-token minting is heavier (a real Retell API call) — a
 * tighter budget. */
export const widgetVoiceTokenRateLimiter = new SlidingWindowRateLimiter(60_000, 6);

export function clientIpFromRequest(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0]?.trim() ?? "unknown";
  return request.headers.get("x-real-ip") ?? "unknown";
}
