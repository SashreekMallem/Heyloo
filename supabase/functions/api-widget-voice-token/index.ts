// Deno entrypoint. verify_jwt: false — this function is publicly reachable
// from an arbitrary third-party website (no Supabase user session exists
// in this flow at all); `handleWidgetVoiceToken` is what actually
// authorizes the caller, via the `widget_token` body field.

import { getSql } from "../_shared/deno/db.ts";
import { requireEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { handleWidgetVoiceToken } from "./handler.ts";

const logger = createLogger({ fn: "api-widget-voice-token" });
const RETELL_API_KEY = requireEnv("RETELL_API_KEY");
const WIDGET_TOKEN_SECRET = requireEnv("WIDGET_TOKEN_SECRET");

function corsHeaders(origin: string | null): Record<string, string> {
  return { "access-control-allow-origin": origin ?? "*", vary: "Origin" };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...corsHeaders(origin),
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "content-type",
      },
    });
  }
  if (req.method !== "POST") {
    return jsonResponse(
      { error: "method_not_allowed" },
      { status: 405, headers: corsHeaders(origin) },
    );
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, { status: 400, headers: corsHeaders(origin) });
  }
  const widgetToken = (json as { widget_token?: unknown })?.widget_token;

  const sql = getSql();
  const result = await handleWidgetVoiceToken(
    sql,
    typeof widgetToken === "string" ? widgetToken : undefined,
    {
      retellFetch: fetch,
      retellApiKey: RETELL_API_KEY,
      widgetTokenSecret: WIDGET_TOKEN_SECRET,
      logger,
    },
  );

  return jsonResponse(result.body, { status: result.status, headers: corsHeaders(origin) });
});
