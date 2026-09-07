// Deno entrypoint (excluded from ../tsconfig.json). Invoked periodically by
// pg_cron (e.g. every 15 minutes, offset from the submit job) via
// pg_net.http_post, shared cron secret same as every other job-*/worker-*
// function.

import { timingSafeEqual } from "../_shared/crypto.js";
import { getSql } from "../_shared/deno/db.js";
import { optionalEnv, requireEnv } from "../_shared/deno/env.js";
import { createLogger } from "../_shared/logger.js";
import { jsonResponse } from "../_shared/responses.js";
import { collectResearchBatch, findInFlightResearchBatchIds } from "./handler.js";

const logger = createLogger({ fn: "job-outreach-personalize-collect" });
const CRON_SECRET = requireEnv("CRON_INVOKE_SECRET");
const ANTHROPIC_API_KEY = requireEnv("ANTHROPIC_API_KEY");
const PERSONALIZE_MODEL = optionalEnv("ANTHROPIC_OUTREACH_PERSONALIZE_MODEL") ?? "claude-sonnet-5";
const SMARTLEAD_API_KEY = requireEnv("SMARTLEAD_API_KEY");
const CAN_SPAM_FOOTER = requireEnv("OUTREACH_CAN_SPAM_FOOTER");

Deno.serve(async (req: Request) => {
  const provided = req.headers.get("x-cron-secret");
  if (!provided || !timingSafeEqual(provided, CRON_SECRET)) {
    return jsonResponse({ error: "unauthorized" }, { status: 401 });
  }

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
