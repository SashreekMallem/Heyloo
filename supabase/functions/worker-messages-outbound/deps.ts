import type { EnvGetter } from "../_shared/providers/messaging/registry.ts";
import { buildMessagingRegistryFromEnv } from "../_shared/providers/messaging/registry.ts";
import type { MessagingFetch } from "../_shared/providers/messaging/types.ts";
import type { Logger } from "../_shared/types.ts";
import type { OutboundDeps } from "./handler.ts";

/**
 * Env -> `OutboundDeps` for both entrypoints that drain this queue
 * (`worker-messages-outbound/index.ts`, `worker-tick/index.ts`), so they can
 * never drift. MESSAGING-1: the leg runs when ANY provider can send (email
 * alone is enough — the old gate required Twilio AND Resend together, so
 * email could never go out without Twilio). With nothing configured it
 * reports every missing name and the caller runs OPS-8's not-configured
 * sweep instead.
 */
export function buildOutboundDeps(
  env: EnvGetter,
  fetchImpl: MessagingFetch,
  logger: Logger,
): { configured: true; deps: OutboundDeps } | { configured: false; missing: string[] } {
  const registry = buildMessagingRegistryFromEnv(env, fetchImpl);
  if (!registry.anyConfigured()) return { configured: false, missing: registry.missing() };
  const statusWebhookBaseUrl = env("WEBHOOKS_SMS_BASE_URL");
  return {
    configured: true,
    deps: {
      registry,
      ...(statusWebhookBaseUrl ? { statusWebhookBaseUrl } : {}),
      logger,
    },
  };
}
