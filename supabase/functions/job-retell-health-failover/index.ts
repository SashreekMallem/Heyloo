// Deno entrypoint (excluded from ../tsconfig.json). Invoked every 2 minutes
// by pg_cron (BACKEND_SPEC §8, G5) via pg_net.http_post.
import { timingSafeEqual } from "../_shared/crypto.js";
import { getSql } from "../_shared/deno/db.js";
import { requireEnv } from "../_shared/deno/env.js";
import { createLogger } from "../_shared/logger.js";
import { jsonResponse } from "../_shared/responses.js";
import { runHealthCheckCycle } from "./handler.js";

const logger = createLogger({ fn: "job-retell-health-failover" });
const CRON_SECRET = requireEnv("CRON_INVOKE_SECRET");
const RETELL_API_KEY = requireEnv("RETELL_API_KEY");
const TWILIO_ACCOUNT_SID = requireEnv("TWILIO_ACCOUNT_SID");
const TWILIO_AUTH_TOKEN = requireEnv("TWILIO_AUTH_TOKEN");
const FAILOVER_VOICE_URL = requireEnv("RETELL_FAILOVER_VOICE_URL");

Deno.serve(async (req: Request) => {
  const provided = req.headers.get("x-cron-secret");
  if (!provided || !timingSafeEqual(provided, CRON_SECRET)) {
    return jsonResponse({ error: "unauthorized" }, { status: 401 });
  }

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
