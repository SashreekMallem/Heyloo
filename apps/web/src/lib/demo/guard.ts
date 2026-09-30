import { NextResponse } from "next/server";
import { clientIpFromRequest, SlidingWindowRateLimiter } from "@/lib/widget/rate-limit";

/**
 * Guards for the public, unauthenticated `/api/demo/generate` and
 * `/api/demo/confirm` routes (QA SEC-04). Each accepted request fetches a
 * visitor-supplied website and calls an LLM (generate) or mints a real Retell
 * web-call token (confirm), so both sit behind the same three layers the
 * instant demo has: same-origin only, a per-IP sliding window and a global
 * hourly ceiling. The limiters are in-process (per warm instance, the accepted
 * gap `lib/widget/rate-limit.ts` documents); `api-demo-agent` adds a
 * database-backed ceiling of its own that survives cold starts.
 */

/** Building a demo from a website: an LLM call plus a page fetch, so a tight window. */
export const demoGenerateIpLimiter = new SlidingWindowRateLimiter(10 * 60_000, 5);
export const demoGenerateGlobalLimiter = new SlidingWindowRateLimiter(60 * 60_000, 120);

/** Confirming (minting the call token): a handful of retries per visitor. */
export const demoConfirmIpLimiter = new SlidingWindowRateLimiter(10 * 60_000, 8);
export const demoConfirmGlobalLimiter = new SlidingWindowRateLimiter(60 * 60_000, 240);

const RETRY_AFTER_SECONDS = 600;

/** Refuses a browser request whose `Origin` is not this site. A request with no `Origin` (curl, server-to-server) is left to the rate limits. */
export function forbiddenOriginResponse(request: Request): NextResponse | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  let originHost: string | null = null;
  try {
    originHost = new URL(origin).host;
  } catch {
    originHost = null;
  }
  if (!host || originHost !== host) {
    return NextResponse.json({ error: "forbidden_origin" }, { status: 403 });
  }
  return null;
}

/** Per-IP window first and short-circuiting: an address that is already over its own limit is refused without spending any of the global budget. */
export function rateLimitedResponse(
  request: Request,
  perIp: SlidingWindowRateLimiter,
  global: SlidingWindowRateLimiter,
): NextResponse | null {
  const ip = clientIpFromRequest(request);
  if (perIp.allow(ip) && global.allow("all")) return null;
  return NextResponse.json(
    { error: "rate_limited" },
    { status: 429, headers: { "retry-after": String(RETRY_AFTER_SECONDS) } },
  );
}
