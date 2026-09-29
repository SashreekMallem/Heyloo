// Deno entrypoint (excluded from ../tsconfig.json). verify_jwt false in
// supabase/config.toml — providers call this directly and are
// authenticated by their own signature scheme, verified on the raw body by
// the provider adapter (CLAUDE.md Rule 2, fail closed).
//
// Routes (MESSAGING-1, docs/design/MESSAGING_PROVIDERS.md):
//   POST /functions/v1/webhooks-sms/<provider>          inbound messages
//   POST /functions/v1/webhooks-sms/<provider>/status   delivery receipts
// Point the provider's inbound/messaging-profile webhook at the first; the
// worker passes the second as the per-message status callback when
// WEBHOOKS_SMS_BASE_URL is set.

import { getSql } from "../_shared/deno/db.ts";
import { optionalEnv } from "../_shared/deno/env.ts";
import {
  backgroundRunner,
  buildSmsWebhookRegistry,
  buildTextEngineDeps,
} from "../_shared/deno/sms-webhook-deps.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { handleSmsWebhook, parseSmsWebhookRoute, publicWebhookUrl } from "./handler.ts";

const logger = createLogger({ fn: "webhooks-sms" });
const REGISTRY = buildSmsWebhookRegistry();
// The PUBLIC URL of this function (e.g.
// https://<ref>.supabase.co/functions/v1/webhooks-sms). Signature schemes
// that sign the URL (Twilio) must see exactly what the provider called,
// not the runtime's internal URL — fail closed without it.
const BASE_URL = optionalEnv("WEBHOOKS_SMS_BASE_URL");
const TEXT_ENGINE_DEPS = buildTextEngineDeps(logger);

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }
  if (!BASE_URL) {
    logger.error("sms_webhook_not_configured", { missing: ["WEBHOOKS_SMS_BASE_URL"] });
    return jsonResponse({ error: "not_configured" }, { status: 503 });
  }

  const url = new URL(req.url);
  const route = parseSmsWebhookRoute(url.pathname);
  if (!route) return jsonResponse({ error: "not_found" }, { status: 404 });

  const rawBody = await req.text();
  const response = await handleSmsWebhook(
    {
      sql: getSql(),
      logger,
      ...(TEXT_ENGINE_DEPS ? { textEngineDeps: TEXT_ENGINE_DEPS } : {}),
      runInBackground: backgroundRunner(logger),
    },
    REGISTRY.smsProvider(route.providerId),
    {
      rawBody,
      url: publicWebhookUrl(BASE_URL, route, url.search),
      header: (name) => req.headers.get(name),
    },
  );
  return new Response(response.body, {
    status: response.status,
    headers: { "content-type": response.contentType },
  });
});
