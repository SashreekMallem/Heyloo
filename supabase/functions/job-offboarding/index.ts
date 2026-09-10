// Deno entrypoint (excluded from ../tsconfig.json). Invoked by pg_cron
// (SYSTEM_DESIGN §9 offboarding wind-down — see handler.ts docstring for
// why this runs daily at 05:45 UTC rather than a spec-literal cadence, no
// exact schedule is specified for this job).
import { timingSafeEqual } from "../_shared/crypto.ts";
import { getSql } from "../_shared/deno/db.ts";
import { requireEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { runOffboarding } from "./handler.ts";

const logger = createLogger({ fn: "job-offboarding" });
const CRON_SECRET = requireEnv("CRON_INVOKE_SECRET");
const RETELL_API_KEY = requireEnv("RETELL_API_KEY");
const TWILIO_ACCOUNT_SID = requireEnv("TWILIO_ACCOUNT_SID");
const TWILIO_AUTH_TOKEN = requireEnv("TWILIO_AUTH_TOKEN");

Deno.serve(async (req: Request) => {
  const provided = req.headers.get("x-cron-secret");
  if (!provided || !timingSafeEqual(provided, CRON_SECRET)) {
    return jsonResponse({ error: "unauthorized" }, { status: 401 });
  }

  const sql = getSql();
  const result = await runOffboarding(sql, new Date(), {
    retellFetch: fetch,
    retellApiKey: RETELL_API_KEY,
    twilioFetch: fetch,
    twilioAccountSid: TWILIO_ACCOUNT_SID,
    twilioAuthToken: TWILIO_AUTH_TOKEN,
    logger,
  });
  logger.info("job_offboarding_complete", result);
  return jsonResponse(result);
});
