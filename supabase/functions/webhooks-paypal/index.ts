// Deno entrypoint (excluded from ../tsconfig.json). verify_jwt false in
// supabase/config.toml — PayPal's own webhook-signature verification is
// checked below (fail closed), same posture as webhooks-stripe/index.ts.
import { runInBackground } from "../_shared/deno/background.ts";
import { getSql } from "../_shared/deno/db.ts";
import { optionalEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { getAccessToken, paypalBaseUrl } from "../_shared/providers/paypal.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { insertWebhookEventIfNew, markWebhookEventProcessed } from "../_shared/webhook-dedup.ts";
import { processPayPalEvent } from "./handler.ts";
import { PayPalWebhookEventSchema } from "./schema.ts";
import { extractPayPalWebhookHeaders, verifyPayPalWebhookSignature } from "./signature.ts";

const logger = createLogger({ fn: "webhooks-paypal" });
// OPS-5 (docs/BUILD_NOTES.md): PayPal isn't provisioned on every deploy
// yet — `optionalEnv` (not `requireEnv`) keeps cold start from crashing;
// the handler below fails CLOSED whenever either credential is missing,
// rejecting every request with 503 before the OAuth/signature-verification
// calls that need them ever run (CLAUDE.md Rule 2 — never skip
// verification, never process without it).
const PAYPAL_CLIENT_ID = optionalEnv("PAYPAL_CLIENT_ID");
const PAYPAL_CLIENT_SECRET = optionalEnv("PAYPAL_CLIENT_SECRET");
const PAYPAL_WEBHOOK_ID = optionalEnv("PAYPAL_WEBHOOK_ID");
const BASE_URL = paypalBaseUrl(optionalEnv("PAYPAL_ENV") === "live" ? "live" : "sandbox");

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
  }

  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    logger.error("paypal_webhook_not_configured");
    return jsonResponse({ error: "not_configured" }, { status: 503 });
  }

  const rawBody = await req.text();
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = PayPalWebhookEventSchema.safeParse(parsedBody);
  if (!parsed.success) {
    logger.warn("paypal_bad_request", { issues: parsed.error.issues });
    return jsonResponse({ error: "invalid_request" }, { status: 400 });
  }
  const event = parsed.data;

  const tokenResult = await getAccessToken(fetch, BASE_URL, PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET);
  if (!tokenResult.ok || !tokenResult.accessToken) {
    logger.error("paypal_webhook_oauth_failed", { status: tokenResult.status });
    return jsonResponse({ error: "unauthorized" }, { status: 401 });
  }

  const verification = await verifyPayPalWebhookSignature({
    fetchImpl: fetch,
    baseUrl: BASE_URL,
    accessToken: tokenResult.accessToken,
    webhookId: PAYPAL_WEBHOOK_ID,
    headers: extractPayPalWebhookHeaders(req.headers),
    webhookEvent: parsedBody,
  });
  if (!verification.valid) {
    logger.warn("paypal_signature_rejected", { reason: verification.reason, id: event.id });
    return jsonResponse({ error: "unauthorized" }, { status: 401 });
  }

  const sql = getSql();
  const dedup = await insertWebhookEventIfNew(sql, {
    source: "paypal",
    eventId: event.id,
    eventType: event.event_type,
    payload: parsedBody,
    signatureVerified: true,
  });

  if (!dedup.isNew) {
    return jsonResponse({ received: true });
  }

  runInBackground(
    async () => {
      try {
        await processPayPalEvent(sql, event, logger);
        if (dedup.webhookEventId) await markWebhookEventProcessed(sql, dedup.webhookEventId);
      } catch (err) {
        logger.error("paypal_background_error", { error: String(err), type: event.event_type });
        if (dedup.webhookEventId)
          await markWebhookEventProcessed(sql, dedup.webhookEventId, String(err));
      }
    },
    (err) => logger.error("paypal_background_unhandled", { error: String(err) }),
  );

  return jsonResponse({ received: true });
});
