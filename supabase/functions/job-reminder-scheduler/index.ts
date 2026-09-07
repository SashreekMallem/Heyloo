// Deno entrypoint (excluded from ../tsconfig.json). Invoked hourly by
// pg_cron (MASTER_SPEC §3.6) via pg_net.http_post.
import { timingSafeEqual } from "../_shared/crypto.js";
import { getSql } from "../_shared/deno/db.js";
import { requireEnv } from "../_shared/deno/env.js";
import { createLogger } from "../_shared/logger.js";
import { jsonResponse } from "../_shared/responses.js";
import { findReminderCandidates, scheduleOneReminder } from "./handler.js";

const logger = createLogger({ fn: "job-reminder-scheduler" });
const CRON_SECRET = requireEnv("CRON_INVOKE_SECRET");

Deno.serve(async (req: Request) => {
  const provided = req.headers.get("x-cron-secret");
  if (!provided || !timingSafeEqual(provided, CRON_SECRET)) {
    return jsonResponse({ error: "unauthorized" }, { status: 401 });
  }

  const sql = getSql();
  const now = new Date();
  const candidates = await findReminderCandidates(sql, now);

  const tally = { sent: 0, deferred_quiet_hours: 0, no_consent: 0, no_phone: 0 };
  for (const row of candidates) {
    const outcome = await scheduleOneReminder(sql, row, now);
    tally[outcome] += 1;
  }

  logger.info("job_reminder_scheduler_complete", { total: candidates.length, ...tally });
  return jsonResponse({ total: candidates.length, ...tally });
});
