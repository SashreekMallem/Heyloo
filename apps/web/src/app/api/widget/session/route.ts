import { NextResponse } from "next/server";
import { z } from "zod";
import { clientIpFromRequest, widgetSessionRateLimiter } from "@/lib/widget/rate-limit";
import { resolveWidgetTenant } from "@/lib/widget/resolve-tenant";
import { mintWidgetToken } from "@/lib/widget/session-token";

export const runtime = "nodejs";

const bodySchema = z.object({ widget_public_key: z.string().min(1).max(200) });

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
 * `POST /api/widget/session` — mints the short-lived
 * `WIDGET_TOKEN_SECRET`-signed session token (BACKEND_SPEC.md §13.2)
 * `packages/widget` uses for both Voice (`POST /api/widget/voice-token`)
 * and Chat (`api-text-chat`, called directly — see
 * `docs/audit/CHANNELS_REQUESTS.md` item 4). Same origin-allowlist +
 * `widget_public_key` gate as `GET /api/widget/config`
 * (`resolveWidgetTenant`), plus a rate limit — this is the ONLY route that
 * actually mints the credential downstream routes trust, so it is the one
 * place abuse has to be stopped at.
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

  if (!widgetSessionRateLimiter.allow(`${ip}:${parsed.data.widget_public_key}`)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers });
  }

  const tenant = await resolveWidgetTenant(parsed.data.widget_public_key, origin);
  if (!tenant) return NextResponse.json({ error: "not_found" }, { status: 404, headers });

  const { token, expiresAt } = mintWidgetToken({
    tenantId: tenant.tenantId,
    widgetPublicKey: parsed.data.widget_public_key,
    origin: origin ?? "",
  });

  return NextResponse.json(
    { widget_token: token, expires_at: expiresAt },
    { status: 200, headers },
  );
}
