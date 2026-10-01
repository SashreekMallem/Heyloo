// Deno entrypoint (excluded from ../tsconfig.json). Invoked every 5 minutes
// by pg_cron (20261001120000_agent_auto_republish.sql) via pg_net.http_post,
// the same cron-secret-authenticated shape as job-lead-callback-retry.
import { timingSafeEqual } from "../_shared/crypto.ts";
import { getSql } from "../_shared/deno/db.ts";
import { requireEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { runAutoRepublish } from "./handler.ts";

const logger = createLogger({ fn: "job-agent-auto-republish" });
const CRON_SECRET = requireEnv("CRON_INVOKE_SECRET");
const RETELL_API_KEY = requireEnv("RETELL_API_KEY");
const VOICE_TOOLS_WEBHOOK_URL = requireEnv("VOICE_TOOLS_WEBHOOK_URL");
const VOICE_EVENTS_WEBHOOK_URL = requireEnv("VOICE_EVENTS_WEBHOOK_URL");
const RETELL_INBOUND_WEBHOOK_URL = requireEnv("RETELL_INBOUND_WEBHOOK_URL");

Deno.serve(async (req: Request) => {
  const provided = req.headers.get("x-cron-secret");
  if (!provided || !timingSafeEqual(provided, CRON_SECRET)) {
    return jsonResponse({ error: "unauthorized" }, { status: 401 });
  }

  const tally = await runAutoRepublish(getSql(), {
    retellFetch: fetch,
    retellApiKey: RETELL_API_KEY,
    voiceToolsWebhookUrl: VOICE_TOOLS_WEBHOOK_URL,
    eventsWebhookUrl: VOICE_EVENTS_WEBHOOK_URL,
    retellInboundWebhookUrl: RETELL_INBOUND_WEBHOOK_URL,
    logger,
  });

  logger.info("job_agent_auto_republish_complete", { ...tally });
  return jsonResponse(tally);
});
