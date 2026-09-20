// Deno entrypoint (excluded from ../tsconfig.json). Invoked hourly by
// pg_cron (20260911140100_job_outreach_review_score_cron_schedule.sql) via
// pg_net.http_post, shared cron secret same as every other job-*/worker-*
// function.

import { timingSafeEqual } from "../_shared/crypto.ts";
import { getSql } from "../_shared/deno/db.ts";
import { missingEnv, optionalEnv, requireEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { runReviewScorePass } from "./handler.ts";

const logger = createLogger({ fn: "job-outreach-review-score" });
const CRON_SECRET = requireEnv("CRON_INVOKE_SECRET");

// Outscraper + Anthropic are the OPTIONAL-integration secrets here (OPS-1,
// docs/BUILD_NOTES.md): read lazily inside the handler, after the
// cron-secret check, so the job skips cleanly instead of crashing
// cold-start hourly while outreach isn't configured yet.
const OPTIONAL_VARS = ["OUTSCRAPER_API_KEY", "ANTHROPIC_API_KEY"] as const;
// OUTREACH-2's own dedicated env var (task instruction: "ANTHROPIC_OUTREACH_
// RESEARCH_MODEL or a new ANTHROPIC_REVIEW_SCORE_MODEL") — a new,
// separately-named var rather than reusing ANTHROPIC_OUTREACH_RESEARCH_MODEL
// (job-outreach-personalize's own website-summarization pass): the two are
// different prompts with different failure modes/cost profiles, and this
// codebase's own naming convention already gives every outreach Anthropic
// call site its own var (ANTHROPIC_OUTREACH_RESEARCH_MODEL,
// _PERSONALIZE_MODEL, _CLASSIFY_MODEL) rather than sharing one across
// unrelated steps. Defaults to `claude-haiku-4-5` — the cheapest current
// model per node_modules/@anthropic-ai/sdk's own `Model` union type, same
// default every other cheap outreach classification/research call site in
// this codebase already uses.
const REVIEW_SCORE_MODEL =
  optionalEnv("ANTHROPIC_OUTREACH_REVIEW_SCORE_MODEL") ?? "claude-haiku-4-5";

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
  const OUTSCRAPER_API_KEY = requireEnv("OUTSCRAPER_API_KEY");
  const ANTHROPIC_API_KEY = requireEnv("ANTHROPIC_API_KEY");

  const sql = getSql();
  const result = await runReviewScorePass(sql, {
    outscraperFetch: fetch,
    outscraperApiKey: OUTSCRAPER_API_KEY,
    anthropicFetch: fetch,
    anthropicApiKey: ANTHROPIC_API_KEY,
    reviewScoreModel: REVIEW_SCORE_MODEL,
    sleep: SLEEP_MS,
    logger,
  });

  logger.info("job_outreach_review_score_complete", result);
  return jsonResponse(result);
});
