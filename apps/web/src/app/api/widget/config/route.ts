import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { resolveWidgetTenant } from "@/lib/widget/resolve-tenant";

export const runtime = "nodejs";

/**
 * `GET /api/widget/config?key=<widget_public_key>` — the first call the
 * embed script (`packages/widget`) makes. Public and unauthenticated by
 * design (a website visitor has no Heyloo session), gated instead by the
 * two BACKEND_SPEC.md §13.2 checks in `resolveWidgetTenant` (origin
 * allowlist + `widget_public_key` match). Returns only what a visitor's
 * browser needs to render the widget chrome and knows where to call next —
 * never `allowed_origins` itself (that would hand a scraper the tenant's
 * own embed-permission list) and never a provider secret.
 *
 * A missing/disallowed key, a disallowed `Origin`, or `widget_enabled:
 * false` all return the SAME generic 404 — never distinguishing "key
 * exists but origin is wrong" from "key doesn't exist" in the response
 * body, so this endpoint can't be used to enumerate valid
 * `widget_public_key`s from an arbitrary origin.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const widgetPublicKey = url.searchParams.get("key") ?? "";
  const origin = request.headers.get("origin");

  const tenant = await resolveWidgetTenant(widgetPublicKey, origin);
  if (!tenant) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const selfOrigin = url.origin;
  const body = {
    business_name: tenant.businessName,
    accent: tenant.settings.accent,
    position: tenant.settings.position,
    greeting: tenant.settings.greeting,
    modes: tenant.settings.modes,
    session_endpoint: `${selfOrigin}/api/widget/session`,
    voice_token_endpoint: `${selfOrigin}/api/widget/voice-token`,
    chat_endpoint: `${env.supabaseFunctionsUrl}/api-text-chat`,
    voice_runtime_url: `${selfOrigin}/widget-voice.js`,
  };

  return NextResponse.json(body, {
    status: 200,
    headers: {
      // Origin-gated already (resolveWidgetTenant), but the browser's own
      // CORS check for this cross-origin `fetch` (the tenant's own site
      // calling app.heyloo.*) still needs an explicit allow header echoing
      // the exact allowed origin (never "*" — this response is
      // origin-specific by construction).
      "access-control-allow-origin": origin ?? "",
      vary: "Origin",
      "cache-control": "no-store",
    },
  });
}
