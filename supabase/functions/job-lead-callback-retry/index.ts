// Deno entrypoint (excluded from ../tsconfig.json). Invoked hourly by
// pg_cron (see 20260910160000_wave2_cron.sql) via pg_net.http_post —
// mirrors job-reminder-scheduler's own cron-secret-authenticated shape.
import { timingSafeEqual } from "../_shared/crypto.ts";
import { getSql } from "../_shared/deno/db.ts";
import { requireEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { runLeadCallbackRetrySweep } from "./handler.ts";

const logger = createLogger({ fn: "job-lead-callback-retry" });
const CRON_SECRET = requireEnv("CRON_INVOKE_SECRET");
const RETELL_API_KEY = requireEnv("RETELL_API_KEY");

Deno.serve(async (req: Request) => {
  const provided = req.headers.get("x-cron-secret");
  if (!provided || !timingSafeEqual(provided, CRON_SECRET)) {
    return jsonResponse({ error: "unauthorized" }, { status: 401 });
  }

  const sql = getSql();
  const tally = await runLeadCallbackRetrySweep(sql, {
    retellFetch: fetch,
    retellApiKey: RETELL_API_KEY,
    logger,
  });

  logger.info("job_lead_callback_retry_complete", tally);
  return jsonResponse(tally);
});
