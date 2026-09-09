// Deno entrypoint (excluded from ../tsconfig.json). Auth: shared-secret
// header (BACKEND_SPEC §7.5 — "Smartlead/Instantly webhook signature or
// shared-secret header per that provider's current docs; confirm which of
// the two is selected before coding"); a bearer/shared-secret compare is
// the fail-closed default until the provider is picked and a real HMAC
// scheme is verified (docs/VERIFY.md).

import { timingSafeEqual } from "../_shared/crypto.ts";
import { runInBackground } from "../_shared/deno/background.ts";
import { getSql } from "../_shared/deno/db.ts";
import { optionalEnv, requireEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { NormalizedOutreachEventSchema } from "../_shared/schemas/outreach-event.ts";
import { insertWebhookEventIfNew, markWebhookEventProcessed } from "../_shared/webhook-dedup.ts";
import { processOutreachEvent } from "./handler.ts";

const logger = createLogger({ fn: "webhooks-outreach" });
const OUTREACH_WEBHOOK_SECRET = requireEnv("OUTREACH_WEBHOOK_SECRET");
const ANTHROPIC_API_KEY = optionalEnv("ANTHROPIC_API_KEY");
const ANTHROPIC_CLASSIFY_MODEL =
  optionalEnv("ANTHROPIC_OUTREACH_CLASSIFY_MODEL") ?? "claude-haiku-4-5";
const SMARTLEAD_API_KEY = optionalEnv("SMARTLEAD_API_KEY");

/**
 * Smartlead's own webhook event-type set (MASTER_SPEC binds Smartlead as
 * the chosen sender — see `_shared/providers/smartlead.ts`'s docstring).
 * VERIFY.md: confirmed high-confidence for the event-type names and the
 * `campaign_id`/`to_email`/`message_id` fields (WebSearch-indexed summary
 * of Smartlead's own webhook-events reference); LOW confidence for the
 * exact reply-body field name (tried in priority order below) and whether
 * Smartlead exposes a distinct spam-complaint event at all — no such event
 * appears in its documented catalog, so the CAN-SPAM 0.3% auto-pause rule
 * currently only fires from a webhook that never actually arrives; a
 * manual `POST /admin-outreach/replies/:id/actions {action:"suppress"}` or
 * bounce-rate-based proxy is the practical path until this is confirmed
 * (flagged in docs/VERIFY.md, not silently left to look like it works).
 */
type NormalizedOutreachEventShape = {
  campaign_external_id: string;
  lead_email_or_phone: string;
  event: "reply" | "open" | "click" | "bounce" | "complaint" | "unsubscribe";
  body?: string;
  occurred_at: string;
  provider_message_id?: string;
};

const SMARTLEAD_EVENT_MAP: Record<string, NormalizedOutreachEventShape["event"]> = {
  EMAIL_OPEN: "open",
  EMAIL_LINK_CLICK: "click",
  EMAIL_REPLY: "reply",
  EMAIL_BOUNCE: "bounce",
  LEAD_UNSUBSCRIBED: "unsubscribe",
};

/** Normalizes Smartlead's flat webhook payload into the canonical shape
 * (BACKEND_SPEC §7.5). Returns `null` for an event type this build doesn't
 * (or can't yet) act on — `EMAIL_SENT`/`LEAD_CATEGORY_UPDATED` have no
 * corresponding canonical event and are ack'd without processing, never
 * mis-mapped to a real one. */
function normalizeProviderPayload(raw: Record<string, unknown>): unknown {
  const eventType =
    typeof raw["event_type"] === "string" ? (raw["event_type"] as string) : undefined;
  if (!eventType || eventType === "EMAIL_SENT" || eventType === "LEAD_CATEGORY_UPDATED")
    return null;
  const canonicalEvent = SMARTLEAD_EVENT_MAP[eventType];
  if (!canonicalEvent) return null;

  const campaignId = raw["campaign_id"];
  const toEmail = raw["to_email"];
  const replyBody =
    (raw["reply_message"] as string | undefined) ??
    (raw["reply_body"] as string | undefined) ??
    (raw["email_body"] as string | undefined) ??
    (raw["message"] as string | undefined);
  const occurredAt =
    (raw["time_sent"] as string | undefined) ??
    (raw["reply_time"] as string | undefined) ??
    (raw["time"] as string | undefined) ??
    new Date().toISOString();

  return {
    campaign_external_id: campaignId !== undefined ? String(campaignId) : "",
    lead_email_or_phone: typeof toEmail === "string" ? toEmail : "",
    event: canonicalEvent,
    ...(replyBody ? { body: replyBody } : {}),
    occurred_at: occurredAt,
    ...(typeof raw["message_id"] === "string" ? { provider_message_id: raw["message_id"] } : {}),
  } satisfies NormalizedOutreachEventShape;
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

  const normalized = normalizeProviderPayload(rawBody);
  if (normalized === null) {
    // A real Smartlead event type this build deliberately doesn't act on
    // (EMAIL_SENT/LEAD_CATEGORY_UPDATED) — ack, never a 400 (a 400 here
    // would look like a broken webhook to Smartlead's own retry logic).
    return jsonResponse({ received: true, ignored: true });
  }

  const parsed = NormalizedOutreachEventSchema.safeParse(normalized);
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
        await processOutreachEvent(sql, event, {
          ...(ANTHROPIC_API_KEY
            ? {
                anthropic: {
                  fetchImpl: fetch,
                  apiKey: ANTHROPIC_API_KEY,
                  model: ANTHROPIC_CLASSIFY_MODEL,
                },
              }
            : {}),
          ...(SMARTLEAD_API_KEY
            ? { smartlead: { fetchImpl: fetch, apiKey: SMARTLEAD_API_KEY } }
            : {}),
        });
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
