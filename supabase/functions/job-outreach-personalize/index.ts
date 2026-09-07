// Deno entrypoint (excluded from ../tsconfig.json). Invoked periodically by
// pg_cron (e.g. every 15 minutes — new leads get queued in bursts by an
// admin action, not continuously) via pg_net.http_post, shared cron secret
// same as every other job-*/worker-* function.

import { timingSafeEqual } from "../_shared/crypto.js";
import { getSql } from "../_shared/deno/db.js";
import { optionalEnv, requireEnv } from "../_shared/deno/env.js";
import { createLogger } from "../_shared/logger.js";
import { jsonResponse } from "../_shared/responses.js";
import { findLeadsNeedingResearch, submitResearchBatch } from "./handler.js";

const logger = createLogger({ fn: "job-outreach-personalize" });
const CRON_SECRET = requireEnv("CRON_INVOKE_SECRET");
const ANTHROPIC_API_KEY = requireEnv("ANTHROPIC_API_KEY");
const RESEARCH_MODEL = optionalEnv("ANTHROPIC_OUTREACH_RESEARCH_MODEL") ?? "claude-haiku-4-5";

const SCRAPE_TIMEOUT_MS = 10_000;

async function fetchUrl(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS);
    const res = await fetch(url, { signal: controller.signal, redirect: "follow" });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  const provided = req.headers.get("x-cron-secret");
  if (!provided || !timingSafeEqual(provided, CRON_SECRET)) {
    return jsonResponse({ error: "unauthorized" }, { status: 401 });
  }

  const sql = getSql();
  const leads = await findLeadsNeedingResearch(sql);
  const result = await submitResearchBatch(sql, leads, {
    anthropicFetch: fetch,
    anthropicApiKey: ANTHROPIC_API_KEY,
    researchModel: RESEARCH_MODEL,
    fetchUrl,
    logger,
  });

  logger.info("job_outreach_personalize_submit_complete", result);
  return jsonResponse(result);
});
