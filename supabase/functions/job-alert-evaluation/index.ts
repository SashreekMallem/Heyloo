// Deno entrypoint (excluded from ../tsconfig.json). Invoked every 5 minutes
// by pg_cron (BACKEND_SPEC §8) via pg_net.http_post.
import { timingSafeEqual } from "../_shared/crypto.js";
import { getSql } from "../_shared/deno/db.js";
import { requireEnv } from "../_shared/deno/env.js";
import { createLogger } from "../_shared/logger.js";
import { jsonResponse } from "../_shared/responses.js";
import { runAlertEvaluation } from "./handler.js";

const logger = createLogger({ fn: "job-alert-evaluation" });
const CRON_SECRET = requireEnv("CRON_INVOKE_SECRET");

Deno.serve(async (req: Request) => {
  const provided = req.headers.get("x-cron-secret");
  if (!provided || !timingSafeEqual(provided, CRON_SECRET)) {
    return jsonResponse({ error: "unauthorized" }, { status: 401 });
  }

  const sql = getSql();
  const alerts = await runAlertEvaluation(sql);
  if (alerts.length > 0) {
    logger.warn("job_alert_evaluation_new_alerts", {
      count: alerts.length,
      rules: alerts.map((a) => a.rule),
    });
    // Push/email fan-out to platform admins reuses the messages_outbound
    // worker's own channel dispatch — left as a follow-up wiring (admin
    // notification preferences aren't modeled yet) rather than duplicated
    // here; the `alerts` row itself is the source of truth the admin
    // cockpit polls (BACKEND_SPEC §7.7 "Alerts" endpoint group).
  }

  return jsonResponse({ new_alerts: alerts.length });
});
