import { NextResponse } from "next/server";
import { z } from "zod";
import { DEFAULT_DEMO_VERTICAL, DEMO_VERTICAL_IDS } from "@/components/demo/demo-verticals";
import { demoInstantGlobalLimiter, demoInstantIpLimiter } from "@/lib/demo/rate-limit";
import { callEdgeFunction } from "@/lib/edge-functions";
import { clientIpFromRequest } from "@/lib/widget/rate-limit";

export const runtime = "nodejs";

/**
 * What `api-demo-agent` answers to `{ instant: true }`. Validated at the
 * boundary (CLAUDE.md Rule 1.2): only the token, how to join it, the phone
 * and the call ceiling ever reach the browser.
 */
const instantDemoResponseSchema = z.object({
  retell_call_token: z.string().min(1),
  /** The shared demo line; absent when none is configured. */
  demo_phone_e164: z.string().min(1).optional(),
  max_call_ms: z.number().int().positive(),
  /** Transport, call id and ICE servers the browser SDK needs to join (optional: older edge builds omit it). */
  retell_web_call: z
    .object({
      call_id: z.string().min(1).optional(),
      transport: z.enum(["gateway", "livekit"]).optional(),
      ice_servers: z
        .array(
          z.object({
            urls: z.union([z.string(), z.array(z.string())]),
            username: z.string().optional(),
            credential: z.string().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

/**
 * The request body: the business type to talk to, from a strict allowlist
 * (the same one `api-demo-agent` enforces). An empty body means the default
 * (auto repair), what builds before the picker sent implicitly.
 */
const instantDemoRequestSchema = z.object({
  vertical: z.enum(DEMO_VERTICAL_IDS).default(DEFAULT_DEMO_VERTICAL),
});

const RETRY_AFTER_SECONDS = 600;
/** Minting a token is one Retell call; past this the visitor is better served by the phone fallback. */
const EDGE_TIMEOUT_MS = 8_000;

/**
 * `POST /api/demo/instant`: the "Talk to Heyloo" button. Mints a web-call
 * token for the demo agent of the business type the visitor picked
 * (`{ vertical }`, a strict allowlist; no scrape) through the `api-demo-agent`
 * edge function, so the Retell secret never reaches the browser. Public, so it
 * is guarded three ways: same-origin only, a per-IP sliding window, and a
 * global hourly ceiling. The 30 second call limit is enforced by the browser
 * (it hangs up at 28 s) with Retell's `max_call_duration_ms` (60 s, its
 * minimum) as the backstop, both set up by the edge function.
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

  // A malformed or off-allowlist request is refused before it can touch the
  // limiters or the edge function (it costs nothing to refuse).
  let rawBody: unknown = {};
  const text = await request.text();
  if (text.trim() !== "") {
    try {
      rawBody = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }
  }
  const requested = instantDemoRequestSchema.safeParse(rawBody);
  if (!requested.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
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
      body: { instant: true, vertical: requested.data.vertical },
      timeoutMs: EDGE_TIMEOUT_MS,
    }));
  } catch {
    return NextResponse.json({ error: "demo_error" }, { status: 503 });
  }
  // The edge function answers 503 `demo_unavailable` when the picked business
  // type has no live demo agent yet: pass that through so the page can say so.
  if (
    status === 503 &&
    typeof body === "object" &&
    body !== null &&
    (body as Record<string, unknown>)["error"] === "demo_unavailable"
  ) {
    return NextResponse.json({ error: "demo_unavailable" }, { status: 503 });
  }
  if (status !== 200) {
    return NextResponse.json({ error: "demo_error" }, { status: 502 });
  }

  const parsed = instantDemoResponseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "demo_error" }, { status: 502 });
  }
  return NextResponse.json(parsed.data, { headers: { "cache-control": "no-store" } });
}
