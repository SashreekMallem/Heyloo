// Deno entrypoint (excluded from ../tsconfig.json). verify_jwt false in
// supabase/config.toml — Twilio calls this directly with its own
// X-Twilio-Signature scheme (CLAUDE.md Rule 2, fail closed).
//
// MESSAGING-1: kept only because Twilio numbers may already point here. It
// is a thin alias for the provider-neutral pipeline in
// `../webhooks-sms/handler.ts` with the provider fixed to Twilio; all
// Twilio parsing/signature logic lives in the Twilio messaging adapter
// (`_shared/providers/messaging/twilio.ts`). New numbers should use
// `/webhooks-sms/twilio` instead.

import { getSql } from "../_shared/deno/db.ts";
import { optionalEnv } from "../_shared/deno/env.ts";
import {
  backgroundRunner,
  buildSmsWebhookRegistry,
  buildTextEngineDeps,
} from "../_shared/deno/sms-webhook-deps.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { handleSmsWebhook } from "../webhooks-sms/handler.ts";

const logger = createLogger({ fn: "webhooks-twilio-sms" });
const REGISTRY = buildSmsWebhookRegistry();
// The exact URL Twilio signed against — must match the number's configured
// webhook URL byte-for-byte. Missing = reject every request (fail closed).
const FUNCTION_URL = optionalEnv("WEBHOOKS_TWILIO_SMS_URL");
const TEXT_ENGINE_DEPS = buildTextEngineDeps(logger);

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }
  if (!FUNCTION_URL) {
    logger.error("twilio_sms_webhook_not_configured", { missing: ["WEBHOOKS_TWILIO_SMS_URL"] });
    return jsonResponse({ error: "not_configured" }, { status: 503 });
  }

  const rawBody = await req.text();
  const response = await handleSmsWebhook(
    {
      sql: getSql(),
      logger,
      ...(TEXT_ENGINE_DEPS ? { textEngineDeps: TEXT_ENGINE_DEPS } : {}),
      runInBackground: backgroundRunner(logger),
    },
    REGISTRY.smsProvider("twilio"),
    { rawBody, url: FUNCTION_URL, header: (name) => req.headers.get(name) },
  );
  return new Response(response.body, {
    status: response.status,
    headers: { "content-type": response.contentType },
  });
});
