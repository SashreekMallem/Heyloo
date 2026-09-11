import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { clientIpFromRequest, widgetVoiceTokenRateLimiter } from "@/lib/widget/rate-limit";
import { verifyWidgetToken } from "@/lib/widget/session-token";

export const runtime = "nodejs";

const bodySchema = z.object({ widget_token: z.string().min(1) });

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    "access-control-allow-origin": origin ?? "",
    vary: "Origin",
    "cache-control": "no-store",
  };
}

export async function OPTIONS(request: Request): Promise<NextResponse> {
  const origin = request.headers.get("origin");
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...corsHeaders(origin),
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
    },
  });
}

/**
 * `POST /api/widget/voice-token` — mints a Retell web-call token for the
 * TENANT's own real published agent (never the demo/test agent), for
 * Voice mode. Provider isolation (CLAUDE.md Rule 2) means this route
 * itself never touches the Retell SDK/REST API directly — it verifies the
 * `widget_token` (proves the caller already passed the origin+key gate at
 * `/api/widget/session`) and proxies to the new
 * `supabase/functions/api-widget-voice-token` edge function, which is
 * where the actual `createWebCall` happens — same shape as
 * `apps/web/src/app/api/tenant/test-agent/web-call/route.ts`'s proxy to
 * `api-tenant-test-call` for the authenticated-dashboard equivalent of
 * this same flow.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const origin = request.headers.get("origin");
  const headers = corsHeaders(origin);
  const ip = clientIpFromRequest(request);

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400, headers });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success)
    return NextResponse.json({ error: "invalid_request" }, { status: 422, headers });

  const verified = verifyWidgetToken(parsed.data.widget_token);
  if (!verified.ok) {
    const status = verified.reason === "expired" ? 401 : 403;
    return NextResponse.json({ error: `${verified.reason}_widget_token` }, { status, headers });
  }
  // The token's own `origin` claim was checked against `allowed_origins`
  // once, at mint time (`/api/widget/session`) — re-checking it against
  // THIS request's Origin here too means a stolen token can't be replayed
  // from a different site even inside its short TTL.
  if (verified.payload.origin !== (origin ?? "")) {
    return NextResponse.json({ error: "origin_mismatch" }, { status: 403, headers });
  }

  if (!widgetVoiceTokenRateLimiter.allow(`${ip}:${verified.payload.tenant_id}`)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers });
  }

  try {
    // Forward the ORIGINAL signed token, not the tenant_id we already
    // extracted from it — the edge function is publicly reachable
    // (`verify_jwt: false`, no Supabase user JWT in this flow at all) and
    // independently re-verifies the same HMAC construction itself
    // (`_shared/widget-token.ts`) rather than trusting a bare tenant_id
    // this route could otherwise be tricked or coerced into forwarding.
    const res = await fetch(`${env.supabaseFunctionsUrl}/api-widget-voice-token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ widget_token: parsed.data.widget_token }),
    });
    const body = await res.text();
    return new NextResponse(body, {
      status: res.status,
      headers: { ...headers, "content-type": "application/json" },
    });
  } catch {
    return NextResponse.json({ error: "voice_token_unavailable" }, { status: 503, headers });
  }
}
