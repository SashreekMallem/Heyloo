// Deno entrypoint (excluded from ../tsconfig.json). Invoked periodically by
// pg_cron (e.g. every 15 minutes, offset from the submit job) via
// pg_net.http_post, shared cron secret same as every other job-*/worker-*
// function.

import { timingSafeEqual } from "../_shared/crypto.ts";
import { getSql } from "../_shared/deno/db.ts";
import { missingEnv, requireEnv } from "../_shared/deno/env.ts";
import { resolveLlmForBatchFromEnv, resolveLlmFromEnv } from "../_shared/deno/llm.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { collectResearchBatch, findInFlightResearchBatchIds } from "./handler.ts";

const logger = createLogger({ fn: "job-outreach-personalize-collect" });
const CRON_SECRET = requireEnv("CRON_INVOKE_SECRET");
// OUTREACH_CAN_SPAM_FOOTER is a compliance hard rule (.env.example), not an
// optional integration secret — stays required at module scope, unchanged.
const CAN_SPAM_FOOTER = requireEnv("OUTREACH_CAN_SPAM_FOOTER");

// Smartlead is an OPTIONAL-integration secret here (OPS-1, docs/BUILD_NOTES.md),
// and the LLM key (LLM-1: Gemini by default) is resolved the same lazy,
// non-throwing way: both are read inside the handler, after the cron-secret
// check, so the job skips cleanly instead of crashing cold-start every 15
// minutes while outreach isn't configured yet.
const OPTIONAL_VARS = ["SMARTLEAD_API_KEY"] as const;

Deno.serve(async (req: Request) => {
  const provided = req.headers.get("x-cron-secret");
  if (!provided || !timingSafeEqual(provided, CRON_SECRET)) {
    return jsonResponse({ error: "unauthorized" }, { status: 401 });
  }

  const llm = resolveLlmFromEnv();
  const missing = [...(llm.ok ? [] : llm.missing), ...missingEnv(OPTIONAL_VARS)];
  if (!llm.ok || missing.length > 0) {
    logger.warn("job_skipped_not_configured", { missing });
    return jsonResponse({ skipped: "not_configured", missing }, { status: 200 });
  }
  const SMARTLEAD_API_KEY = requireEnv("SMARTLEAD_API_KEY");

  const sql = getSql();
  const deps = {
    llm: llm.client,
    smartleadFetch: fetch,
    smartleadApiKey: SMARTLEAD_API_KEY,
    canSpamFooter: CAN_SPAM_FOOTER,
    logger,
  };

  const batchIds = await findInFlightResearchBatchIds(sql);
  let collected = 0;
  let batchesEnded = 0;
  for (const batchId of batchIds) {
    // A batch is read from the vendor that issued its id (it may pre-date a
    // provider switch); the hook write uses the current provider.
    const batchLlm = resolveLlmForBatchFromEnv(batchId);
    if (!batchLlm.ok) {
      logger.warn("outreach_batch_provider_not_configured", {
        batch_id: batchId,
        missing: batchLlm.missing,
      });
      continue;
    }
    const result = await collectResearchBatch(sql, batchId, {
      ...deps,
      batchLlm: batchLlm.client,
    });
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
