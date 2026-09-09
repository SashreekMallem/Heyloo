// Deno entrypoint (excluded from ../tsconfig.json). Invoked hourly by
// pg_cron (MASTER_SPEC §3.9) via pg_net.http_post.
import { timingSafeEqual } from "../_shared/crypto.ts";
import { getSql } from "../_shared/deno/db.ts";
import { requireEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { findReviewCandidates, sendOneReviewRequest } from "./handler.ts";

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
