// Deno entrypoint (excluded from ../tsconfig.json). Verify -> dedup ->
// fast-ack -> background, exactly BACKEND_SPEC §7.3's pipeline. verify_jwt
// is false in supabase/config.toml for this function.
import { runInBackground } from "../_shared/deno/background.ts";
import { getSql } from "../_shared/deno/db.ts";
import { requireRetellWebhookKey } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { verifyRetellSignature } from "../_shared/retell-signature.ts";
import { VoiceEventRequestSchema } from "../_shared/schemas/voice-events.ts";
import { insertWebhookEventIfNew, markWebhookEventProcessed } from "../_shared/webhook-dedup.ts";
import { processVoiceEvent } from "./handler.ts";

const logger = createLogger({ fn: "voice-events" });
const RETELL_WEBHOOK_SIGNING_SECRET = requireRetellWebhookKey();

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
        await processVoiceEvent(sql, event, logger);
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
