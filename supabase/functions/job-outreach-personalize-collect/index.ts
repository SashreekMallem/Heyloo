// Deno entrypoint (excluded from ../tsconfig.json). Invoked periodically by
// pg_cron (e.g. every 15 minutes, offset from the submit job) via
// pg_net.http_post, shared cron secret same as every other job-*/worker-*
// function.

import { timingSafeEqual } from "../_shared/crypto.ts";
import { getSql } from "../_shared/deno/db.ts";
import { missingEnv, optionalEnv, requireEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { collectResearchBatch, findInFlightResearchBatchIds } from "./handler.ts";

const logger = createLogger({ fn: "job-outreach-personalize-collect" });
const CRON_SECRET = requireEnv("CRON_INVOKE_SECRET");
const PERSONALIZE_MODEL = optionalEnv("ANTHROPIC_OUTREACH_PERSONALIZE_MODEL") ?? "claude-sonnet-5";
// OUTREACH_CAN_SPAM_FOOTER is a compliance hard rule (.env.example), not an
// optional integration secret — stays required at module scope, unchanged.
const CAN_SPAM_FOOTER = requireEnv("OUTREACH_CAN_SPAM_FOOTER");

// Anthropic + Smartlead are the OPTIONAL-integration secrets here (OPS-1,
// docs/BUILD_NOTES.md): read lazily inside the handler, after the
// cron-secret check, so the job skips cleanly instead of crashing
// cold-start every 15 minutes while outreach isn't configured yet.
const OPTIONAL_VARS = ["ANTHROPIC_API_KEY", "SMARTLEAD_API_KEY"] as const;

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
  const ANTHROPIC_API_KEY = requireEnv("ANTHROPIC_API_KEY");
  const SMARTLEAD_API_KEY = requireEnv("SMARTLEAD_API_KEY");

  const sql = getSql();
  const deps = {
    anthropicFetch: fetch,
    anthropicApiKey: ANTHROPIC_API_KEY,
    personalizeModel: PERSONALIZE_MODEL,
    smartleadFetch: fetch,
    smartleadApiKey: SMARTLEAD_API_KEY,
    canSpamFooter: CAN_SPAM_FOOTER,
    logger,
  };

  const batchIds = await findInFlightResearchBatchIds(sql);
  let collected = 0;
  let batchesEnded = 0;
  for (const batchId of batchIds) {
    const result = await collectResearchBatch(sql, batchId, deps);
    collected += result.collected;
    if (result.ended) batchesEnded += 1;
  }

  logger.info("job_outreach_personalize_collect_complete", {
    batches_checked: batchIds.length,
    batches_ended: batchesEnded,
    leads_collected: collected,
  });
  return jsonResponse({
    batches_checked: batchIds.length,
    batches_ended: batchesEnded,
    leads_collected: collected,
  });
});
