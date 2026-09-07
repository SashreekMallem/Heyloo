// Deno entrypoint (excluded from ../tsconfig.json). Auth: shared-secret
// header (BACKEND_SPEC §7.5 — "Smartlead/Instantly webhook signature or
// shared-secret header per that provider's current docs; confirm which of
// the two is selected before coding"); a bearer/shared-secret compare is
// the fail-closed default until the provider is picked and a real HMAC
// scheme is verified (docs/VERIFY.md).

import { timingSafeEqual } from "../_shared/crypto.js";
import { runInBackground } from "../_shared/deno/background.js";
import { getSql } from "../_shared/deno/db.js";
import { requireEnv } from "../_shared/deno/env.js";
import { createLogger } from "../_shared/logger.js";
import { jsonResponse } from "../_shared/responses.js";
import { NormalizedOutreachEventSchema } from "../_shared/schemas/outreach-event.js";
import { insertWebhookEventIfNew, markWebhookEventProcessed } from "../_shared/webhook-dedup.js";
import { processOutreachEvent } from "./handler.js";

const logger = createLogger({ fn: "webhooks-outreach" });
const OUTREACH_WEBHOOK_SECRET = requireEnv("OUTREACH_WEBHOOK_SECRET");

/**
 * Normalizes a provider payload into the canonical shape (BACKEND_SPEC
 * §7.5). VERIFY.md: field names are placeholders pending the provider pick
 * (Smartlead vs Instantly) — this passthrough assumes the raw payload
 * already roughly matches the canonical shape, which is true for neither
 * provider's real webhook today and MUST be replaced with a real per-
 * provider mapper before go-live.
 */
function normalizeProviderPayload(raw: Record<string, unknown>): unknown {
  return raw;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
  }

  const providedSecret = req.headers.get("x-webhook-secret");
  if (!providedSecret || !timingSafeEqual(providedSecret, OUTREACH_WEBHOOK_SECRET)) {
    logger.warn("outreach_secret_rejected");
    return jsonResponse({ error: "unauthorized" }, { status: 401 });
  }

  let rawBody: Record<string, unknown>;
  try {
    rawBody = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = NormalizedOutreachEventSchema.safeParse(normalizeProviderPayload(rawBody));
  if (!parsed.success) {
    logger.warn("outreach_bad_request", { issues: parsed.error.issues });
    return jsonResponse({ error: "invalid_request" }, { status: 400 });
  }
  const event = parsed.data;

  const sql = getSql();
  const eventId =
    event.provider_message_id ??
    `${event.campaign_external_id}:${event.event}:${event.occurred_at}`;
  const dedup = await insertWebhookEventIfNew(sql, {
    source: "outreach",
    eventId,
    eventType: event.event,
    payload: rawBody,
    signatureVerified: true,
  });

  if (!dedup.isNew) {
    return jsonResponse({ received: true });
  }

  runInBackground(
    async () => {
      try {
        await processOutreachEvent(sql, event);
        if (dedup.webhookEventId) await markWebhookEventProcessed(sql, dedup.webhookEventId);
      } catch (err) {
        logger.error("outreach_background_error", { error: String(err) });
        if (dedup.webhookEventId)
          await markWebhookEventProcessed(sql, dedup.webhookEventId, String(err));
      }
    },
    (err) => logger.error("outreach_background_unhandled", { error: String(err) }),
  );

  return jsonResponse({ received: true });
});
