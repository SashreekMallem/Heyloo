// Deno entrypoint (excluded from ../tsconfig.json). verify_jwt: false —
// PUBLIC endpoint called DIRECTLY from the browser, cross-origin, from an
// arbitrary tenant's own website (docs/audit/CHANNELS_REQUESTS.md item 4
// — no Supabase user session exists here at all). Auth is the
// `widget_token` (schema.ts/handler.ts), never a bearer JWT.
import { getSql } from "../_shared/deno/db.ts";
import { optionalEnv, requireEnv } from "../_shared/deno/env.ts";
import { resolveLlmFromEnv } from "../_shared/deno/llm.ts";
import { createLogger } from "../_shared/logger.ts";
import { aiNotConfiguredBody } from "../_shared/providers/llm/registry.ts";
import { buildMessagingRegistryFromEnv } from "../_shared/providers/messaging/registry.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { isSmsAvailable } from "../_shared/sms-availability.ts";
import type { TextAgentDeps } from "../_shared/text-agent/engine.ts";
import { handleTextChat } from "./handler.ts";
import { TextChatRequestSchema } from "./schema.ts";

const logger = createLogger({ fn: "api-text-chat" });
// OPS-5 / LLM-1 (docs/BUILD_NOTES.md): LLM credentials aren't provisioned on
// every deploy — the client is resolved lazily per request (never at module
// load, so a missing key can't crash the isolate) and an unusable provider
// answers a clean 503 `{error:"ai_not_configured", missing:[...]}` below,
// never attempting the text-agent engine call without it.
const APP_BASE_URL = optionalEnv("APP_BASE_URL") ?? "https://heyloo.app";
const STRIPE_SECRET_KEY = optionalEnv("STRIPE_SECRET_KEY") ?? "";
const PAYMENT_LINK_SUCCESS_URL =
  optionalEnv("PAYMENT_LINK_SUCCESS_URL") ?? "https://heyloo.app/pay/success";
const PAYMENT_LINK_CANCEL_URL =
  optionalEnv("PAYMENT_LINK_CANCEL_URL") ?? "https://heyloo.app/pay/cancelled";
const WIDGET_TOKEN_SECRET = requireEnv("WIDGET_TOKEN_SECRET");
// MSG-3: built once per isolate, no network (`_shared/sms-availability.ts`).
const MESSAGING = buildMessagingRegistryFromEnv((name) => Deno.env.get(name), fetch);

const HARD_ABORT_MS = 12_000; // above the engine's own ~8s internal budget, below a typical browser fetch timeout

// CORS (docs/audit/CHANNELS_REQUESTS.md item 4): the widget runs on the
// tenant's own third-party origin, never `app.heyloo.*` — the request
// Origin is echoed back rather than `*` (future-proofing against ever
// adding credentialed requests, even though this contract carries none
// today) since the real per-tenant access boundary is the `widget_token`
// itself, not CORS.
function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "*";
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    vary: "origin",
  };
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, { status: 405, headers: cors });
  }

  const llm = resolveLlmFromEnv();
  if (!llm.ok) {
    logger.error("api_text_chat_not_configured", {
      provider: llm.providerId,
      missing: llm.missing,
    });
    return jsonResponse(aiNotConfiguredBody(llm), { status: 503, headers: cors });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_request" }, { status: 422, headers: cors });
  }

  const parsed = TextChatRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonResponse({ error: "invalid_request" }, { status: 422, headers: cors });
  }

  const sql = getSql();
  const deps: TextAgentDeps & { widgetTokenSecret: string } = {
    sql,
    // MSG-3: promise a text (payment link, code) only when the tenant can send one.
    smsAvailable: (tenantId) => isSmsAvailable(sql, tenantId, MESSAGING),
    logger,
    llm: llm.client,
    appBaseUrl: APP_BASE_URL,
    paymentLink: {
      fetchImpl: fetch,
      stripeSecretKey: STRIPE_SECRET_KEY,
      successUrl: PAYMENT_LINK_SUCCESS_URL,
      cancelUrl: PAYMENT_LINK_CANCEL_URL,
    },
    // DELIVERY-1: keyless US Census Geocoder (fixed host).
    censusFetch: fetch,
    turnTimeoutMs: HARD_ABORT_MS,
    widgetTokenSecret: WIDGET_TOKEN_SECRET,
  };

  const result = await handleTextChat(deps, logger, parsed.data);
  return jsonResponse(result.body, { status: result.status, headers: cors });
});
