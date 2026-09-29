// Deno entrypoint (excluded from ../tsconfig.json). Invoked hourly by
// pg_cron (20260911140100_job_outreach_review_score_cron_schedule.sql) via
// pg_net.http_post, shared cron secret same as every other job-*/worker-*
// function.

import { timingSafeEqual } from "../_shared/crypto.ts";
import { getSql } from "../_shared/deno/db.ts";
import { missingEnv, requireEnv } from "../_shared/deno/env.ts";
import { resolveLlmFromEnv } from "../_shared/deno/llm.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { runReviewScorePass } from "./handler.ts";

const logger = createLogger({ fn: "job-outreach-review-score" });
const CRON_SECRET = requireEnv("CRON_INVOKE_SECRET");

// Outscraper is an OPTIONAL-integration secret here (OPS-1, docs/BUILD_NOTES.md):
// read lazily inside the handler, after the cron-secret check, so the job skips
// cleanly instead of crashing cold-start hourly while outreach isn't configured
// yet. The LLM (LLM-1: Gemini by default, `GEMINI_MODEL`) is resolved the same
// lazy, non-throwing way and skips the run when no provider is usable.
const OPTIONAL_VARS = ["OUTSCRAPER_API_KEY"] as const;

const SLEEP_MS = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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
  const llm = resolveLlmFromEnv();
  if (!llm.ok) {
    logger.warn("job_skipped_not_configured", { missing: llm.missing, provider: llm.providerId });
    return jsonResponse({ skipped: "not_configured", missing: llm.missing }, { status: 200 });
  }
  const OUTSCRAPER_API_KEY = requireEnv("OUTSCRAPER_API_KEY");

  const sql = getSql();
  const result = await runReviewScorePass(sql, {
    outscraperFetch: fetch,
    outscraperApiKey: OUTSCRAPER_API_KEY,
    llm: llm.client,
    sleep: SLEEP_MS,
    logger,
  });

  logger.info("job_outreach_review_score_complete", result);
  return jsonResponse(result);
});
