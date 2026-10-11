// Deno entrypoint (excluded from ../tsconfig.json). Verify -> dedup ->
// fast-ack -> background, exactly BACKEND_SPEC §7.3's pipeline. verify_jwt
// is false in supabase/config.toml for this function.
import { runInBackground } from "../_shared/deno/background.ts";
import { getSql } from "../_shared/deno/db.ts";
import { optionalEnv, requireRetellWebhookKey } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { verifyRetellSignature } from "../_shared/retell-signature.ts";
import { VoiceEventRequestSchema } from "../_shared/schemas/voice-events.ts";
import { checkTrialCapAfterCall } from "../_shared/trial/cap.ts";
import { insertWebhookEventIfNew, markWebhookEventProcessed } from "../_shared/webhook-dedup.ts";
import { processVoiceEvent, type VoiceEventHooks } from "./handler.ts";

const logger = createLogger({ fn: "voice-events" });
const RETELL_WEBHOOK_SIGNING_SECRET = requireRetellWebhookKey();
// TRIAL-1: the free-trial minutes cap ends a trial through Stripe after the
// call that reached it. Optional (OPS-5 precedent): without the key the cap is
// only logged here and job-billing-cycle's hourly `?task=trial_caps` run (or
// the next call once the key exists) ends the trial.
const STRIPE_SECRET_KEY = optionalEnv("STRIPE_SECRET_KEY");
const BILLING_PAGE_URL = optionalEnv("BILLING_PORTAL_RETURN_URL");

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
  }

  const rawBody = await req.text();
  const verification = await verifyRetellSignature({
    rawBody,
    header: req.headers.get("x-retell-signature"),
    secret: RETELL_WEBHOOK_SIGNING_SECRET,
    now: new Date(),
  });
  if (!verification.valid) {
    logger.warn("voice_events_signature_rejected", { reason: verification.reason });
    return jsonResponse({ error: "unauthorized" }, { status: 401 });
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = VoiceEventRequestSchema.safeParse(parsedBody);
  if (!parsed.success) {
    logger.warn("voice_events_bad_request", { issues: parsed.error.issues });
    return jsonResponse({ error: "invalid_request" }, { status: 400 });
  }

  const sql = getSql();
  const event = parsed.data;
  const hooks: VoiceEventHooks = {
    onBillableUsage: (tenantId) =>
      checkTrialCapAfterCall(sql, tenantId, {
        stripeFetch: fetch,
        stripeSecretKey: STRIPE_SECRET_KEY,
        billingPageUrl: BILLING_PAGE_URL,
        logger,
      }),
  };
  const eventId = `${event.call.call_id}:${event.event}`;

  const dedup = await insertWebhookEventIfNew(sql, {
    source: "retell",
    eventId,
    eventType: event.event,
    payload: parsedBody,
    signatureVerified: true,
  });

  // Fast-ack immediately after the dedup insert succeeds/no-ops — background
  // processing (and its own duration) never blocks Retell's response.
  if (!dedup.isNew) {
    return jsonResponse({ received: true });
  }

  runInBackground(
    async () => {
      try {
        await processVoiceEvent(sql, event, logger, hooks);
        if (dedup.webhookEventId) await markWebhookEventProcessed(sql, dedup.webhookEventId);
      } catch (err) {
        logger.error("voice_events_background_error", { error: String(err), event: event.event });
        if (dedup.webhookEventId) {
          await markWebhookEventProcessed(sql, dedup.webhookEventId, String(err));
        }
      }
    },
    (err) => logger.error("voice_events_background_unhandled", { error: String(err) }),
  );

  return jsonResponse({ received: true });
});
