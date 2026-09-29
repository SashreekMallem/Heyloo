// Deno entrypoint (excluded from ../tsconfig.json). Route:
// /functions/v1/webhooks-pos/{provider} — provider dispatched by path
// segment (BACKEND_SPEC §7.6). Four adapters wired (T7): `square` (webhook-
// driven, HMAC-SHA256(notificationUrl+rawBody)), `shopmonkey` (webhook-
// driven, HMAC-SHA256(rawBody) — a documented hypothesis, see
// _shared/providers/shopmonkey.ts), `google_calendar` (push-notification
// channel, no HMAC — a per-connection shared-secret channel token instead,
// resolved by looking up which tenant's connection registered the
// `X-Goog-Channel-ID` on the request), and `ezyvet` (still `501` — no
// confirmed webhook coverage exists for appointment changes; two-way sync
// for that adapter is poll-only, see worker-adapter-push).
import { getSql } from "../_shared/deno/db.ts";
import { optionalEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import {
  normalizeGoogleCalendarNotification,
  verifyGoogleCalendarNotification,
} from "../_shared/providers/google-calendar.ts";
import {
  normalizeShopmonkeyWebhook,
  verifyShopmonkeyWebhookSignature,
} from "../_shared/providers/shopmonkey.ts";
import { normalizeSquareWebhook, verifySquareSignature } from "../_shared/providers/square.ts";
import { jsonResponse } from "../_shared/responses.ts";
import type { SqlClient } from "../_shared/types.ts";
import { insertWebhookEventIfNew, markWebhookEventProcessed } from "../_shared/webhook-dedup.ts";
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

function headerRecord(req: Request): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  req.headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
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

/**
 * Google Calendar's push notification carries NO body and no shared
 * platform-wide signing secret — each TENANT'S connection registered its
 * own channel with its own `clientState` (BACKEND_SPEC §7.6, see
 * `_shared/providers/google-calendar.ts`). The `X-Goog-Channel-ID` header
 * is how we find which connection this notification belongs to; the
 * `X-Goog-Channel-Token` header must then match that connection's stored
 * `clientState` before anything is trusted (fail closed exactly like every
 * other adapter's signature check, just keyed differently).
 */
async function handleGoogleCalendar(req: Request, sql: SqlClient): Promise<Response> {
  const headers = headerRecord(req);
  const channelId = headers["x-goog-channel-id"] ?? null;
  if (!channelId) {
    logger.warn("pos_google_calendar_missing_channel_id");
    return jsonResponse({ error: "unauthorized" }, { status: 401 });
  }

  const connectionRows = await sql<{ tenant_id: string; metadata: Record<string, unknown> }>`
    select tenant_id, metadata
    from public.adapter_connections
    where provider = 'google_calendar'
      and metadata ->> 'channelId' = ${channelId}
      and status = 'connected'
    limit 1
  `;
  const connection = connectionRows[0];
  if (!connection) {
    logger.warn("pos_google_calendar_no_matching_connection", { channel_id: channelId });
    return jsonResponse({ error: "unauthorized" }, { status: 401 });
  }

  const verification = verifyGoogleCalendarNotification({
    headers,
    expectedChannelToken:
      typeof connection.metadata["clientState"] === "string"
        ? (connection.metadata["clientState"] as string)
        : undefined,
  });
  if (!verification.valid) {
    logger.warn("pos_google_calendar_signature_rejected", { reason: verification.reason });
    return jsonResponse({ error: "unauthorized" }, { status: 401 });
  }

  const canonical = normalizeGoogleCalendarNotification(verification.headers);
  const messageNumber = headers["x-goog-message-number"] ?? "0";
  const eventId = `${channelId}:${messageNumber}`;

  const dedup = await insertWebhookEventIfNew(sql, {
    source: "google_calendar",
    eventId,
    eventType: canonical.type,
    payload: { channelId, resourceState: headers["x-goog-resource-state"] },
    signatureVerified: true,
  });
  if (dedup.isNew && canonical.type !== "unknown") {
    // Google's notification carries no diffable content (see the shared
    // module's docstring) — the real change is discovered by the poller
    // (worker-adapter-push's pullChanges), never by this handler directly.
    // This is deliberately NOT routed through `processPosWebhook`'s
    // per-external-id conflict logic: `canonical.external_id` here is the
    // watched CALENDAR's resourceId, not a specific event id, so it can
    // never match an `adapter_sync_state` row keyed by event id.
    logger.info("pos_google_calendar_change_notified", {
      tenant_id: connection.tenant_id,
      channel_id: channelId,
    });
    if (dedup.webhookEventId) await markWebhookEventProcessed(sql, dedup.webhookEventId);
  }
  return jsonResponse({ received: true });
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
