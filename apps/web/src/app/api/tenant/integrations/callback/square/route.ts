import { NextResponse } from "next/server";
import { callEdgeFunction } from "@/lib/edge-functions";
import { requireIntegrationsSession } from "../../session";
import { htmlResponseInit, popupResultHtml } from "../../shared";

export const runtime = "nodejs";

/**
 * OAuth redirect landing page for Square (`SQUARE_OAUTH_REDIRECT_URI`,
 * `.env.example`: "callback landing page (apps/web) that forwards code+
 * state here [to api-adapter-connect]"). A dedicated per-provider path
 * (rather than one `?provider=` query param) because each provider has its
 * OWN registered redirect URI env var already, and because Square/Google's
 * own redirect never round-trips an app-chosen extra query param reliably
 * — see docs/BUILD_NOTES.md CLUSTER-F entry.
 *
 * This popup window still carries the tenant owner's own session cookie
 * (same-origin navigation, unlike a server-to-server callback), so the
 * caller's access token is available here exactly like every other
 * authenticated Route Handler — `api-adapter-connect`'s `action: "callback"`
 * re-verifies the signed `state` server-side regardless (tenant_id/provider
 * match), so this route trusts nothing from the query string alone.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    return new NextResponse(
      popupResultHtml({ ok: false, provider: "square", error: `square_oauth_error:${oauthError}` }),
      htmlResponseInit(400),
    );
  }
  if (!code || !state) {
    return new NextResponse(
      popupResultHtml({ ok: false, provider: "square", error: "missing_code_or_state" }),
      htmlResponseInit(400),
    );
  }

  const session = await requireIntegrationsSession();
  if (!session) {
    return new NextResponse(
      popupResultHtml({ ok: false, provider: "square", error: "unauthenticated" }),
      htmlResponseInit(401),
    );
  }

  const { status, body: result } = await callEdgeFunction<{ connected?: boolean; error?: string }>(
    "api-adapter-connect",
    {
      method: "POST",
      accessToken: session.accessToken,
      body: { action: "callback", provider: "square", code, state },
    },
  );

  if (status !== 200 || !result.connected) {
    return new NextResponse(
      popupResultHtml({ ok: false, provider: "square", error: result.error ?? "connect_failed" }),
      htmlResponseInit(status && status !== 200 ? status : 502),
    );
  }
  return new NextResponse(popupResultHtml({ ok: true, provider: "square" }), htmlResponseInit(200));
}
