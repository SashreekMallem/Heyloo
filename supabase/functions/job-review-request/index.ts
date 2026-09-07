// Deno entrypoint (excluded from ../tsconfig.json). Invoked hourly by
// pg_cron (MASTER_SPEC §3.9) via pg_net.http_post.
import { timingSafeEqual } from "../_shared/crypto.js";
import { getSql } from "../_shared/deno/db.js";
import { requireEnv } from "../_shared/deno/env.js";
import { createLogger } from "../_shared/logger.js";
import { jsonResponse } from "../_shared/responses.js";
import { findReviewCandidates, sendOneReviewRequest } from "./handler.js";

const logger = createLogger({ fn: "job-review-request" });
const CRON_SECRET = requireEnv("CRON_INVOKE_SECRET");

Deno.serve(async (req: Request) => {
  const provided = req.headers.get("x-cron-secret");
  if (!provided || !timingSafeEqual(provided, CRON_SECRET)) {
    return jsonResponse({ error: "unauthorized" }, { status: 401 });
  }

  const sql = getSql();
  const candidates = await findReviewCandidates(sql, new Date());

  let sent = 0;
  for (const row of candidates) {
    if (await sendOneReviewRequest(sql, row)) sent += 1;
  }

  logger.info("job_review_request_complete", { sent, total: candidates.length });
  return jsonResponse({ sent, total: candidates.length });
});
