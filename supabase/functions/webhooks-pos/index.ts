// Deno entrypoint (excluded from ../tsconfig.json). Route:
// /functions/v1/webhooks-pos/{provider} — provider dispatched by path
// segment (BACKEND_SPEC §7.6). Only `square` is wired with a real
// `handleWebhook` in this build (T3's assigned scope); every other
// provider row in BACKEND_SPEC §7.6's table is Wave-3/T7 and 501s here
// rather than silently 200-ing (so a misconfigured webhook URL is visible
// in Twilio/provider delivery logs, not silently dropped).
import { getSql } from "../_shared/deno/db.js";
import { requireEnv } from "../_shared/deno/env.js";
import { createLogger } from "../_shared/logger.js";
import { normalizeSquareWebhook, verifySquareSignature } from "../_shared/providers/square.js";
import { jsonResponse } from "../_shared/responses.js";
import { insertWebhookEventIfNew, markWebhookEventProcessed } from "../_shared/webhook-dedup.js";
import { processPosWebhook } from "./handler.js";

const logger = createLogger({ fn: "webhooks-pos" });
const SQUARE_WEBHOOK_SIGNATURE_KEY = requireEnv("SQUARE_WEBHOOK_SIGNATURE_KEY");
const SQUARE_NOTIFICATION_URL = requireEnv("WEBHOOKS_POS_SQUARE_URL");

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
  }

  const url = new URL(req.url);
  const provider = url.pathname.split("/").filter(Boolean).pop() ?? "";

  if (provider !== "square") {
    logger.warn("pos_adapter_not_yet_implemented", { provider });
    return jsonResponse({ error: "adapter_not_implemented", provider }, { status: 501 });
  }

  const rawBody = await req.text();
  const verification = await verifySquareSignature({
    rawBody,
    signatureHeader: req.headers.get("x-square-hmacsha256-signature"),
    notificationUrl: SQUARE_NOTIFICATION_URL,
    signatureKey: SQUARE_WEBHOOK_SIGNATURE_KEY,
  });
  if (!verification.valid) {
    logger.warn("pos_square_signature_rejected", { reason: verification.reason });
    return jsonResponse({ error: "unauthorized" }, { status: 401 });
  }

  let parsedBody: Record<string, unknown>;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: "invalid_json" }, { status: 400 });
  }

  const canonical = normalizeSquareWebhook(parsedBody);
  const eventId =
    typeof parsedBody["event_id"] === "string"
      ? (parsedBody["event_id"] as string)
      : `${canonical.external_id}:${canonical.type}`;

  const sql = getSql();
  const dedup = await insertWebhookEventIfNew(sql, {
    source: "square",
    eventId,
    eventType: canonical.type,
    payload: parsedBody,
    signatureVerified: true,
  });

  if (dedup.isNew) {
    processPosWebhook("square", canonical, logger);
    if (dedup.webhookEventId) await markWebhookEventProcessed(sql, dedup.webhookEventId);
  }

  return jsonResponse({ received: true });
});
