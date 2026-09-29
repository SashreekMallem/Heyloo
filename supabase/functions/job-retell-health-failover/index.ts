// Deno entrypoint (excluded from ../tsconfig.json). Invoked every 2 minutes
// by pg_cron (BACKEND_SPEC §8, G5) via pg_net.http_post.
import { timingSafeEqual } from "../_shared/crypto.ts";
import { getSql } from "../_shared/deno/db.ts";
import { optionalEnv, requireEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { createPhoneNumberRegistry } from "../_shared/providers/phone-numbers/registry.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { runHealthCheckCycle } from "./handler.ts";

const logger = createLogger({ fn: "job-retell-health-failover" });
const CRON_SECRET = requireEnv("CRON_INVOKE_SECRET");
// RETELL_API_KEY is already provisioned (used by the live Retell voice
// integration elsewhere) — stays required at module scope, unchanged.
const RETELL_API_KEY = requireEnv("RETELL_API_KEY");

// NUMBERS-1: Twilio and the failover URL are OPTIONAL. The probe and the
// incident flag always run; Retell-native numbers (both live numbers today)
// are skipped with an ops alert by handler.ts, and Twilio-imported numbers
// are only diverted when Twilio + the failover URL are configured. The old
// all-or-nothing "not configured" skip meant no health probing at all on a
// platform with only Retell-native numbers (OPS-1 precedent otherwise kept:
// nothing here crashes cold-start).
const TWILIO_ACCOUNT_SID = optionalEnv("TWILIO_ACCOUNT_SID");
const TWILIO_AUTH_TOKEN = optionalEnv("TWILIO_AUTH_TOKEN");
const FAILOVER_VOICE_URL = optionalEnv("RETELL_FAILOVER_VOICE_URL");
const DEMO_AGENT_ID = optionalEnv("DEMO_AGENT_ID");

const numbers = createPhoneNumberRegistry({
  retellFetch: fetch,
  retellApiKey: RETELL_API_KEY,
  protectedAgentIds: DEMO_AGENT_ID ? [DEMO_AGENT_ID] : [],
  twilioFetch: fetch,
  twilioAccountSid: TWILIO_ACCOUNT_SID,
  twilioAuthToken: TWILIO_AUTH_TOKEN,
});

Deno.serve(async (req: Request) => {
  const provided = req.headers.get("x-cron-secret");
  if (!provided || !timingSafeEqual(provided, CRON_SECRET)) {
    return jsonResponse({ error: "unauthorized" }, { status: 401 });
  }

  const sql = getSql();
  const action = await runHealthCheckCycle(sql, {
    retellFetch: fetch,
    retellApiKey: RETELL_API_KEY,
    numbers,
    failoverVoiceUrl: FAILOVER_VOICE_URL,
    logger,
  });

  if (action === "failover_triggered" || action === "recovery_restored") {
    logger.error("retell_health_state_transition", { action });
  }

  return jsonResponse({ action });
});
