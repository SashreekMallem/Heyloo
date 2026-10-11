// Deno entrypoint (excluded from ../tsconfig.json). Route:
// /functions/v1/webhooks-pos/{provider} — provider dispatched by path
// segment (BACKEND_SPEC §7.6). Four adapters wired (T7): `square` (webhook-
// driven, HMAC-SHA256(notificationUrl+rawBody)), `shopmonkey` (webhook-
// driven, HMAC-SHA256(rawBody) — a documented hypothesis, see
// _shared/providers/shopmonkey.ts), `google_calendar` (CAL-1b push
// notification, no body and no HMAC — the channel id, a per-channel random
// token checked against its stored hash, and the resource id; see
// ./google-calendar.ts), and `ezyvet` (still `501` — no
// confirmed webhook coverage exists for appointment changes; two-way sync
// for that adapter is poll-only, see worker-adapter-push).
import { getSql } from "../_shared/deno/db.ts";
import { optionalEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import {
  normalizeShopmonkeyWebhook,
  verifyShopmonkeyWebhookSignature,
} from "../_shared/providers/shopmonkey.ts";
import { normalizeSquareWebhook, verifySquareSignature } from "../_shared/providers/square.ts";
import { jsonResponse } from "../_shared/responses.ts";
import type { SqlClient } from "../_shared/types.ts";
import { insertWebhookEventIfNew, markWebhookEventProcessed } from "../_shared/webhook-dedup.ts";
import { handleGoogleCalendarNotification } from "./google-calendar.ts";
import { processPosWebhook } from "./handler.ts";

const logger = createLogger({ fn: "webhooks-pos" });

// QA-1 BE-04: per-provider secrets are read lazily, inside that provider's
// branch. They used to be `requireEnv` at module scope, so ONE unset provider
// secret (e.g. SQUARE_WEBHOOK_SIGNATURE_KEY) returned 500 WORKER_ERROR for
// every provider, including google_calendar, which needs none of them. A
// missing secret is still fail-CLOSED (CLAUDE.md Rule 2): the request is
// rejected with 503 `not_configured`, never processed unverified.
function notConfigured(provider: string, missing: string[]): Response {
  logger.error("pos_webhook_not_configured", { provider, missing });
  return jsonResponse({ error: "not_configured", provider }, { status: 503 });
}

async function handleSquare(req: Request, sql: SqlClient): Promise<Response> {
  const SQUARE_WEBHOOK_SIGNATURE_KEY = optionalEnv("SQUARE_WEBHOOK_SIGNATURE_KEY");
  const SQUARE_NOTIFICATION_URL = optionalEnv("WEBHOOKS_POS_SQUARE_URL");
  if (!SQUARE_WEBHOOK_SIGNATURE_KEY || !SQUARE_NOTIFICATION_URL) {
    return notConfigured("square", [
      ...(SQUARE_WEBHOOK_SIGNATURE_KEY ? [] : ["SQUARE_WEBHOOK_SIGNATURE_KEY"]),
      ...(SQUARE_NOTIFICATION_URL ? [] : ["WEBHOOKS_POS_SQUARE_URL"]),
    ]);
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

  const dedup = await insertWebhookEventIfNew(sql, {
    source: "square",
    eventId,
    eventType: canonical.type,
    payload: parsedBody,
    signatureVerified: true,
  });
  if (dedup.isNew) {
    await processPosWebhook(sql, "square", canonical, logger);
    if (dedup.webhookEventId) await markWebhookEventProcessed(sql, dedup.webhookEventId);
  }
  return jsonResponse({ received: true });
}

async function handleShopmonkey(req: Request, sql: SqlClient): Promise<Response> {
  const SHOPMONKEY_WEBHOOK_SIGNING_SECRET = optionalEnv("SHOPMONKEY_WEBHOOK_SIGNING_SECRET");
  if (!SHOPMONKEY_WEBHOOK_SIGNING_SECRET) {
    return notConfigured("shopmonkey", ["SHOPMONKEY_WEBHOOK_SIGNING_SECRET"]);
  }
  const rawBody = await req.text();
  const verification = await verifyShopmonkeyWebhookSignature({
    rawBody,
    signatureHeader: req.headers.get("x-shopmonkey-signature"),
    signingSecret: SHOPMONKEY_WEBHOOK_SIGNING_SECRET,
  });
  if (!verification.valid) {
    logger.warn("pos_shopmonkey_signature_rejected", { reason: verification.reason });
    return jsonResponse({ error: "unauthorized" }, { status: 401 });
  }

  let parsedBody: Record<string, unknown>;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: "invalid_json" }, { status: 400 });
  }

  const canonical = normalizeShopmonkeyWebhook(parsedBody);
  const eventId =
    typeof parsedBody["id"] === "string"
      ? (parsedBody["id"] as string)
      : `${canonical.external_id}:${canonical.type}`;

  const dedup = await insertWebhookEventIfNew(sql, {
    source: "shopmonkey",
    eventId,
    eventType: canonical.type,
    payload: parsedBody,
    signatureVerified: true,
  });
  if (dedup.isNew) {
    await processPosWebhook(sql, "shopmonkey", canonical, logger);
    if (dedup.webhookEventId) await markWebhookEventProcessed(sql, dedup.webhookEventId);
  }
  return jsonResponse({ received: true });
}

/** CAL-1b: verified against the stored channel (fail closed), deduped in
 * webhook_events, read requested, fast 200 — see ./google-calendar.ts. */
async function handleGoogleCalendar(req: Request, sql: SqlClient): Promise<Response> {
  const result = await handleGoogleCalendarNotification(
    sql,
    (name) => req.headers.get(name),
    logger,
  );
  return jsonResponse(result.body, { status: result.status });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
  }

  const url = new URL(req.url);
  const provider = url.pathname.split("/").filter(Boolean).pop() ?? "";
  const sql = getSql();

  switch (provider) {
    case "square":
      return handleSquare(req, sql);
    case "shopmonkey":
      return handleShopmonkey(req, sql);
    case "google_calendar":
      return handleGoogleCalendar(req, sql);
    default:
      logger.warn("pos_adapter_not_yet_implemented", { provider });
      return jsonResponse({ error: "adapter_not_implemented", provider }, { status: 501 });
  }
});
