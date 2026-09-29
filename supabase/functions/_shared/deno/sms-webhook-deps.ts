// Deno-only glue (excluded from ../../tsconfig.json). Builds the shared
// dependencies of the two inbound-SMS entrypoints — `webhooks-sms` (the
// provider-neutral route) and `webhooks-twilio-sms` (legacy URL Twilio
// numbers already point at) — so they can never drift (MESSAGING-1).
import type { MessagingRegistry } from "../providers/messaging/registry.ts";
import { buildMessagingRegistryFromEnv } from "../providers/messaging/registry.ts";
import type { TextAgentDeps } from "../text-agent/engine.ts";
import type { Logger } from "../types.ts";
import { runInBackground } from "./background.ts";
import { getSql } from "./db.ts";
import { optionalEnv } from "./env.ts";

export function buildSmsWebhookRegistry(): MessagingRegistry {
  return buildMessagingRegistryFromEnv((name) => Deno.env.get(name), fetch);
}

// Text-agent engine deps (Cluster T). `ANTHROPIC_API_KEY` optional: a
// deploy without it still handles STOP/HELP/waitlist-YES correctly and
// falls back to archive-only for an ordinary inbound message.
export function buildTextEngineDeps(logger: Logger): TextAgentDeps | undefined {
  const apiKey = optionalEnv("ANTHROPIC_API_KEY");
  if (!apiKey) return undefined;
  return {
    sql: getSql(),
    logger,
    anthropicFetch: fetch,
    anthropicApiKey: apiKey,
    model: optionalEnv("ANTHROPIC_TEXT_AGENT_MODEL") ?? "claude-sonnet-5",
    appBaseUrl: optionalEnv("APP_BASE_URL") ?? "https://heyloo.app",
    paymentLink: {
      fetchImpl: fetch,
      stripeSecretKey: optionalEnv("STRIPE_SECRET_KEY") ?? "",
      successUrl: optionalEnv("PAYMENT_LINK_SUCCESS_URL") ?? "https://heyloo.app/pay/success",
      cancelUrl: optionalEnv("PAYMENT_LINK_CANCEL_URL") ?? "https://heyloo.app/pay/cancelled",
    },
  };
}

export function backgroundRunner(logger: Logger): (task: () => Promise<void>) => void {
  return (task) =>
    runInBackground(task, (err) =>
      logger.error("sms_webhook_background_error", { error: String(err) }),
    );
}
