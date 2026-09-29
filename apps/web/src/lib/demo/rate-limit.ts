import { SlidingWindowRateLimiter } from "@/lib/widget/rate-limit";

/**
 * Rate limits for the public one-click demo (`POST /api/demo/instant`). Every
 * accepted request mints a real Retell web-call token (real money), so this
 * sits in front of it: the same in-process, per-warm-instance sliding window
 * the widget routes use (`lib/widget/rate-limit.ts`, whose docstring covers
 * the accepted cold-start gap).
 */

/** 4 demo calls per 10 minutes per visitor IP: enough to retry after a mic problem, not enough to farm. */
export const demoInstantIpLimiter = new SlidingWindowRateLimiter(10 * 60_000, 4);

/** A cost ceiling across all visitors on one instance: 240 demo calls an hour. */
export const demoInstantGlobalLimiter = new SlidingWindowRateLimiter(60 * 60_000, 240);
