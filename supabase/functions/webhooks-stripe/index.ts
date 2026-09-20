// Deno entrypoint (excluded from ../tsconfig.json). verify_jwt false in
// supabase/config.toml — Stripe signature verified below (fail closed).
import { runInBackground } from "../_shared/deno/background.ts";
import { getSql } from "../_shared/deno/db.ts";
import { optionalEnv, requireEnv, requireServiceRoleKey } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { StripeEventSchema } from "../_shared/schemas/stripe-event.ts";
import { verifyStripeSignature } from "../_shared/stripe-signature.ts";
import { insertWebhookEventIfNew, markWebhookEventProcessed } from "../_shared/webhook-dedup.ts";
import { processStripeEvent } from "./handler.ts";
import { createInvokeProvisioning } from "./invoke-provisioning.ts";

const logger = createLogger({ fn: "webhooks-stripe" });
// OPS-5 (docs/BUILD_NOTES.md): Stripe is not provisioned on every deploy
// yet. Reading the signing secret with `optionalEnv` instead of
// `requireEnv` keeps this module from crashing the isolate at cold start
// (500 WORKER_ERROR on every request) when it's unset; the handler below
// still fails CLOSED — with no secret to verify against, every request is
// rejected with 503 before the body is ever parsed or dispatched, never
// silently skipping signature verification (CLAUDE.md Rule 2).
const STRIPE_WEBHOOK_SIGNING_SECRET = optionalEnv("STRIPE_WEBHOOK_SIGNING_SECRET");
const SUPABASE_URL = requireEnv("SUPABASE_URL");
const PROVISION_INTERNAL_SECRET = requireEnv("PROVISION_INTERNAL_SECRET");
const SB_SECRET_KEY = requireServiceRoleKey();

const invokeProvisioning = createInvokeProvisioning({
  supabaseUrl: SUPABASE_URL,
  serviceRoleKey: SB_SECRET_KEY,
  internalSecret: PROVISION_INTERNAL_SECRET,
  fetchImpl: fetch,
});

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
  }

  if (!STRIPE_WEBHOOK_SIGNING_SECRET) {
    logger.error("stripe_webhook_not_configured");
    return jsonResponse({ error: "not_configured" }, { status: 503 });
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
        await processStripeEvent(sql, event, logger, { invokeProvisioning });
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
