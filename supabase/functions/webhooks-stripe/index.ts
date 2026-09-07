// Deno entrypoint (excluded from ../tsconfig.json). verify_jwt false in
// supabase/config.toml — Stripe signature verified below (fail closed).
import { runInBackground } from "../_shared/deno/background.js";
import { getSql } from "../_shared/deno/db.js";
import { requireEnv } from "../_shared/deno/env.js";
import { createLogger } from "../_shared/logger.js";
import { jsonResponse } from "../_shared/responses.js";
import { StripeEventSchema } from "../_shared/schemas/stripe-event.js";
import { verifyStripeSignature } from "../_shared/stripe-signature.js";
import { insertWebhookEventIfNew, markWebhookEventProcessed } from "../_shared/webhook-dedup.js";
import { processStripeEvent } from "./handler.js";

const logger = createLogger({ fn: "webhooks-stripe" });
const STRIPE_WEBHOOK_SIGNING_SECRET = requireEnv("STRIPE_WEBHOOK_SIGNING_SECRET");

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
  }

  const rawBody = await req.text();
  const verification = await verifyStripeSignature({
    rawBody,
    header: req.headers.get("stripe-signature"),
    secret: STRIPE_WEBHOOK_SIGNING_SECRET,
    now: new Date(),
  });
  if (!verification.valid) {
    logger.warn("stripe_signature_rejected", { reason: verification.reason });
    return jsonResponse({ error: "unauthorized" }, { status: 401 });
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = StripeEventSchema.safeParse(parsedBody);
  if (!parsed.success) {
    logger.warn("stripe_bad_request", { issues: parsed.error.issues });
    return jsonResponse({ error: "invalid_request" }, { status: 400 });
  }
  const event = parsed.data;

  const sql = getSql();
  const dedup = await insertWebhookEventIfNew(sql, {
    source: "stripe",
    eventId: event.id,
    eventType: event.type,
    payload: parsedBody,
    signatureVerified: true,
  });

  if (!dedup.isNew) {
    return jsonResponse({ received: true });
  }

  runInBackground(
    async () => {
      try {
        await processStripeEvent(sql, event, logger);
        if (dedup.webhookEventId) await markWebhookEventProcessed(sql, dedup.webhookEventId);
      } catch (err) {
        logger.error("stripe_background_error", { error: String(err), type: event.type });
        if (dedup.webhookEventId)
          await markWebhookEventProcessed(sql, dedup.webhookEventId, String(err));
      }
    },
    (err) => logger.error("stripe_background_unhandled", { error: String(err) }),
  );

  return jsonResponse({ received: true });
});
