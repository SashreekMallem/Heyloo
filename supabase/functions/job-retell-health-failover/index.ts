// Deno entrypoint (excluded from ../tsconfig.json). Invoked every 2 minutes
// by pg_cron (BACKEND_SPEC §8, G5) via pg_net.http_post.
import { timingSafeEqual } from "../_shared/crypto.ts";
import { getSql } from "../_shared/deno/db.ts";
import { missingEnv, requireEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { runHealthCheckCycle } from "./handler.ts";

const logger = createLogger({ fn: "job-retell-health-failover" });
const CRON_SECRET = requireEnv("CRON_INVOKE_SECRET");
// RETELL_API_KEY is already provisioned (used by the live Retell voice
// integration elsewhere) — stays required at module scope, unchanged.
const RETELL_API_KEY = requireEnv("RETELL_API_KEY");

// Twilio + failover-URL are the OPTIONAL-integration secrets here (OPS-1,
// docs/BUILD_NOTES.md): the Twilio account and the failover voice URL are
// not provisioned yet, so read them lazily inside the handler, after the
// cron-secret check, so the job skips cleanly instead of crashing cold-start
// every 2 minutes.
const OPTIONAL_VARS = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "RETELL_FAILOVER_VOICE_URL",
] as const;

Deno.serve(async (req: Request) => {
  const provided = req.headers.get("x-cron-secret");
  if (!provided || !timingSafeEqual(provided, CRON_SECRET)) {
    return jsonResponse({ error: "unauthorized" }, { status: 401 });
  }

  const missing = missingEnv(OPTIONAL_VARS);
  if (missing.length > 0) {
    logger.warn("job_skipped_not_configured", { missing });
    return jsonResponse({ skipped: "not_configured", missing }, { status: 200 });
  }
  const TWILIO_ACCOUNT_SID = requireEnv("TWILIO_ACCOUNT_SID");
  const TWILIO_AUTH_TOKEN = requireEnv("TWILIO_AUTH_TOKEN");
  const FAILOVER_VOICE_URL = requireEnv("RETELL_FAILOVER_VOICE_URL");

  const sql = getSql();
  const action = await runHealthCheckCycle(sql, {
    retellFetch: fetch,
    retellApiKey: RETELL_API_KEY,
    twilioFetch: fetch,
    twilioAccountSid: TWILIO_ACCOUNT_SID,
    twilioAuthToken: TWILIO_AUTH_TOKEN,
    failoverVoiceUrl: FAILOVER_VOICE_URL,
    logger,
  });

  if (action === "failover_triggered" || action === "recovery_restored") {
    logger.error("retell_health_state_transition", { action });
  }

  return jsonResponse({ action });
});
