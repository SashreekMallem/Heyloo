import { NextResponse } from "next/server";
import { z } from "zod";
import { demoInstantGlobalLimiter, demoInstantIpLimiter } from "@/lib/demo/rate-limit";
import { callEdgeFunction } from "@/lib/edge-functions";
import { clientIpFromRequest } from "@/lib/widget/rate-limit";

export const runtime = "nodejs";

/**
 * What `api-demo-agent` answers to `{ instant: true }`. Validated at the
 * boundary (CLAUDE.md Rule 1.2): only the token, the phone and the call
 * ceiling ever reach the browser.
 */
const instantDemoResponseSchema = z.object({
  retell_call_token: z.string().min(1),
  demo_phone_e164: z.string().min(1),
  max_call_ms: z.number().int().positive(),
});

const RETRY_AFTER_SECONDS = 600;
/** Minting a token is one Retell call; past this the visitor is better served by the phone fallback. */
const EDGE_TIMEOUT_MS = 8_000;

/**
 * `POST /api/demo/instant`: the home page's "Talk to Heyloo" button. Mints a
 * web-call token for the shared demo agent (sample shop, no scrape) through
 * the `api-demo-agent` edge function, so the Retell secret never reaches the
 * browser. Public, so it is guarded three ways: same-origin only, a per-IP
 * sliding window, and a global hourly ceiling. The call itself is capped by
 * Retell's `max_call_duration_ms` (set in the edge function).
 */
export async function POST(request: Request): Promise<NextResponse> {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (origin) {
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    if (!host || originHost !== host) {
      return NextResponse.json({ error: "forbidden_origin" }, { status: 403 });
    }
  }

  // The per-IP window first, so a flood from one address can never eat the
  // global budget (a denied attempt still counts as a hit in both windows).
  const ip = clientIpFromRequest(request);
  if (!demoInstantIpLimiter.allow(ip) || !demoInstantGlobalLimiter.allow("all")) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "retry-after": String(RETRY_AFTER_SECONDS) } },
    );
  }

  let status: number;
  let body: unknown;
  try {
    ({ status, body } = await callEdgeFunction<unknown>("api-demo-agent", {
      method: "POST",
      body: { instant: true },
      timeoutMs: EDGE_TIMEOUT_MS,
    }));
  } catch {
    return NextResponse.json({ error: "demo_unavailable" }, { status: 503 });
  }
  if (status !== 200) {
    return NextResponse.json({ error: "demo_unavailable" }, { status: 502 });
  }

  const parsed = instantDemoResponseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "demo_unavailable" }, { status: 502 });
  }
  return NextResponse.json(parsed.data, { headers: { "cache-control": "no-store" } });
}
