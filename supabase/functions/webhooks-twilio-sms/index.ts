// Deno entrypoint (excluded from ../tsconfig.json). verify_jwt false in
// supabase/config.toml — Twilio calls this directly with its own
// X-Twilio-Signature scheme (BACKEND_SPEC Rule 2 fail-closed).
import { getSql } from "../_shared/deno/db.js";
import { requireEnv } from "../_shared/deno/env.js";
import { createLogger } from "../_shared/logger.js";
import { formParamsToObject, TwilioInboundSmsSchema } from "../_shared/schemas/twilio-sms.js";
import { verifyTwilioSignature } from "../_shared/twilio-signature.js";
import { insertWebhookEventIfNew, markWebhookEventProcessed } from "../_shared/webhook-dedup.js";
import { processInboundSms } from "./handler.js";

const logger = createLogger({ fn: "webhooks-twilio-sms" });
const TWILIO_AUTH_TOKEN = requireEnv("TWILIO_AUTH_TOKEN");
// The exact URL Twilio signed against — must match the number's configured
// webhook URL byte-for-byte (VERIFY.md: confirm no trailing-slash/query
// mismatch against the actual Twilio console config before go-live).
const FUNCTION_URL = requireEnv("WEBHOOKS_TWILIO_SMS_URL");

function twiml(body?: string): Response {
  const xml = body
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(body)}</Message></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
  return new Response(xml, { headers: { "content-type": "text/xml" } });
}

function escapeXml(s: string): string {
  return s.replace(
    /[<>&'"]/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c] ?? c,
  );
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  const rawBody = await req.text();
  const formParams = formParamsToObject(new URLSearchParams(rawBody));

  const verification = await verifyTwilioSignature({
    url: FUNCTION_URL,
    formParams,
    authToken: TWILIO_AUTH_TOKEN,
    signatureHeader: req.headers.get("x-twilio-signature"),
  });
  if (!verification.valid) {
    logger.warn("twilio_sms_signature_rejected", { reason: verification.reason });
    return new Response("unauthorized", { status: 401 });
  }

  const parsed = TwilioInboundSmsSchema.safeParse(formParams);
  if (!parsed.success) {
    logger.warn("twilio_sms_bad_request", { issues: parsed.error.issues });
    return twiml();
  }
  const sms = parsed.data;

  const sql = getSql();
  const dedup = await insertWebhookEventIfNew(sql, {
    source: "twilio_sms",
    eventId: sms.MessageSid,
    eventType: "inbound_sms",
    payload: formParams,
    signatureVerified: true,
  });

  if (!dedup.isNew) {
    return twiml();
  }

  // STOP/HELP replies must go out synchronously (the TwiML response IS the
  // reply channel) — only the DB side effects run in the background.
  let result: Awaited<ReturnType<typeof processInboundSms>> = {};
  try {
    result = await processInboundSms(sql, sms);
    if (dedup.webhookEventId) await markWebhookEventProcessed(sql, dedup.webhookEventId);
  } catch (err) {
    logger.error("twilio_sms_processing_error", { error: String(err) });
    if (dedup.webhookEventId)
      await markWebhookEventProcessed(sql, dedup.webhookEventId, String(err));
  }

  // The dashboard message-thread realtime broadcast fires from the
  // `messages_inbound` insert trigger itself (a DB-side concern, not this
  // handler's), so there is no further background work to schedule here —
  // the processing above already completed synchronously.
  return twiml(result.replyBody);
});
