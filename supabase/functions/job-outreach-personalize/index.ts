// Deno entrypoint (excluded from ../tsconfig.json). Invoked periodically by
// pg_cron (e.g. every 15 minutes — new leads get queued in bursts by an
// admin action, not continuously) via pg_net.http_post, shared cron secret
// same as every other job-*/worker-* function.

import { timingSafeEqual } from "../_shared/crypto.ts";
import { getSql } from "../_shared/deno/db.ts";
import { requireEnv } from "../_shared/deno/env.ts";
import { resolveLlmFromEnv } from "../_shared/deno/llm.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { findLeadsNeedingResearch, submitResearchBatch } from "./handler.ts";

const logger = createLogger({ fn: "job-outreach-personalize" });
const CRON_SECRET = requireEnv("CRON_INVOKE_SECRET");

// The LLM key is an optional-integration secret (OPS-1, docs/BUILD_NOTES.md;
// LLM-1: Gemini by default): resolved lazily inside the handler, after the
// cron-secret check, so the job skips cleanly instead of crashing cold-start
// every 15 minutes while outreach isn't configured yet.

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

  const llm = resolveLlmFromEnv();
  if (!llm.ok) {
    logger.warn("job_skipped_not_configured", { missing: llm.missing, provider: llm.providerId });
    return jsonResponse({ skipped: "not_configured", missing: llm.missing }, { status: 200 });
  }

  const sql = getSql();
  const leads = await findLeadsNeedingResearch(sql);
  const result = await submitResearchBatch(sql, leads, {
    llm: llm.client,
    fetchUrl,
    logger,
  });

  logger.info("job_outreach_personalize_submit_complete", result);
  return jsonResponse(result);
});
