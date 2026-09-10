import { NextResponse } from "next/server";
import { callEdgeFunction } from "@/lib/edge-functions";
import { requireIntegrationsSession } from "../../session";
import { htmlResponseInit, popupResultHtml } from "../../shared";

export const runtime = "nodejs";

/** OAuth redirect landing page for Google Calendar
 * (`GOOGLE_CALENDAR_OAUTH_REDIRECT_URI`) — see the Square callback route's
 * docstring for the shared per-provider-path reasoning. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    return new NextResponse(
      popupResultHtml({
        ok: false,
        provider: "google_calendar",
        error: `google_oauth_error:${oauthError}`,
      }),
      htmlResponseInit(400),
    );
  }
  if (!code || !state) {
    return new NextResponse(
      popupResultHtml({ ok: false, provider: "google_calendar", error: "missing_code_or_state" }),
      htmlResponseInit(400),
    );
  }

  const session = await requireIntegrationsSession();
  if (!session) {
    return new NextResponse(
      popupResultHtml({ ok: false, provider: "google_calendar", error: "unauthenticated" }),
      htmlResponseInit(401),
    );
  }

  const { status, body: result } = await callEdgeFunction<{ connected?: boolean; error?: string }>(
    "api-adapter-connect",
    {
      method: "POST",
      accessToken: session.accessToken,
      body: { action: "callback", provider: "google_calendar", code, state },
    },
  );

  if (status !== 200 || !result.connected) {
    return new NextResponse(
      popupResultHtml({
        ok: false,
        provider: "google_calendar",
        error: result.error ?? "connect_failed",
      }),
      htmlResponseInit(status && status !== 200 ? status : 502),
    );
  }
  return new NextResponse(
    popupResultHtml({ ok: true, provider: "google_calendar" }),
    htmlResponseInit(200),
  );
}
