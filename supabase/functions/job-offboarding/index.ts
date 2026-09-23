// Deno entrypoint (excluded from ../tsconfig.json). Invoked by pg_cron
// (SYSTEM_DESIGN §9 offboarding wind-down — see handler.ts docstring for
// why this runs daily at 05:45 UTC rather than a spec-literal cadence, no
// exact schedule is specified for this job).
import { timingSafeEqual } from "../_shared/crypto.ts";
import { getSql } from "../_shared/deno/db.ts";
import { optionalEnv, requireEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { runOffboarding } from "./handler.ts";

const logger = createLogger({ fn: "job-offboarding" });
const CRON_SECRET = requireEnv("CRON_INVOKE_SECRET");
const RETELL_API_KEY = requireEnv("RETELL_API_KEY");
// OPS-5/SIGNUP-1 precedent (docs/BUILD_NOTES.md): Twilio is not provisioned
// on this platform yet. `requireEnv` throws at Deno cold-start, which
// crashed EVERY invocation of this job with an opaque WORKER_ERROR — even
// for a tenant with no phone numbers to release at all, the common case
// (QA-BILL live finding, 2026-09-23). Read optionally instead; a tenant
// that genuinely needs a Twilio release fails that one release closed
// (see handler.ts's `twilio_not_configured` outcome) rather than crashing
// the whole run.
const TWILIO_ACCOUNT_SID = optionalEnv("TWILIO_ACCOUNT_SID");
const TWILIO_AUTH_TOKEN = optionalEnv("TWILIO_AUTH_TOKEN");

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
