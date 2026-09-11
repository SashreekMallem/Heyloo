// Deno entrypoint (excluded from ../tsconfig.json). verify_jwt false in
// supabase/config.toml — Twilio calls this directly with its own
// X-Twilio-Signature scheme (BACKEND_SPEC Rule 2 fail-closed).
import { getSql } from "../_shared/deno/db.ts";
import { optionalEnv, requireEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { formParamsToObject, TwilioInboundSmsSchema } from "../_shared/schemas/twilio-sms.ts";
import type { TextAgentDeps } from "../_shared/text-agent/engine.ts";
import { verifyTwilioSignature } from "../_shared/twilio-signature.ts";
import { insertWebhookEventIfNew, markWebhookEventProcessed } from "../_shared/webhook-dedup.ts";
import { processInboundSms } from "./handler.ts";

const logger = createLogger({ fn: "webhooks-twilio-sms" });
const TWILIO_AUTH_TOKEN = requireEnv("TWILIO_AUTH_TOKEN");
// The exact URL Twilio signed against — must match the number's configured
// webhook URL byte-for-byte (VERIFY.md: confirm no trailing-slash/query
// mismatch against the actual Twilio console config before go-live).
const FUNCTION_URL = requireEnv("WEBHOOKS_TWILIO_SMS_URL");

// Text-agent engine deps (Cluster T). `ANTHROPIC_API_KEY` optional here
// (not required): a deploy that hasn't provisioned Anthropic credentials
// yet still handles STOP/HELP/waitlist-YES correctly — it just falls back
// to archive-only for an ordinary inbound message (`textEngineDeps`
// omitted below), same graceful-degradation posture as `GEOCODE_API_KEY`
// in `voice-tools/index.ts`.
const ANTHROPIC_API_KEY = optionalEnv("ANTHROPIC_API_KEY");
const ANTHROPIC_TEXT_AGENT_MODEL = optionalEnv("ANTHROPIC_TEXT_AGENT_MODEL") ?? "claude-sonnet-5";
const APP_BASE_URL = optionalEnv("APP_BASE_URL") ?? "https://heyloo.app";
const STRIPE_SECRET_KEY = optionalEnv("STRIPE_SECRET_KEY") ?? "";
const PAYMENT_LINK_SUCCESS_URL =
  optionalEnv("PAYMENT_LINK_SUCCESS_URL") ?? "https://heyloo.app/pay/success";
const PAYMENT_LINK_CANCEL_URL =
  optionalEnv("PAYMENT_LINK_CANCEL_URL") ?? "https://heyloo.app/pay/cancelled";

const textEngineDeps: TextAgentDeps | undefined = ANTHROPIC_API_KEY
  ? {
      sql: getSql(),
      logger,
      anthropicFetch: fetch,
      anthropicApiKey: ANTHROPIC_API_KEY,
      model: ANTHROPIC_TEXT_AGENT_MODEL,
      appBaseUrl: APP_BASE_URL,
      paymentLink: {
        fetchImpl: fetch,
        stripeSecretKey: STRIPE_SECRET_KEY,
        successUrl: PAYMENT_LINK_SUCCESS_URL,
        cancelUrl: PAYMENT_LINK_CANCEL_URL,
      },
    }
  : undefined;

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
    result = await processInboundSms(sql, sms, textEngineDeps);
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
