// Deno entrypoint (excluded from ../tsconfig.json). Invoked periodically by
// pg_cron (e.g. every 15 minutes — new leads get queued in bursts by an
// admin action, not continuously) via pg_net.http_post, shared cron secret
// same as every other job-*/worker-* function.

import { timingSafeEqual } from "../_shared/crypto.ts";
import { getSql } from "../_shared/deno/db.ts";
import { missingEnv, optionalEnv, requireEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { findLeadsNeedingResearch, submitResearchBatch } from "./handler.ts";

const logger = createLogger({ fn: "job-outreach-personalize" });
const CRON_SECRET = requireEnv("CRON_INVOKE_SECRET");
const RESEARCH_MODEL = optionalEnv("ANTHROPIC_OUTREACH_RESEARCH_MODEL") ?? "claude-haiku-4-5";

// ANTHROPIC_API_KEY is an optional-integration secret (OPS-1,
// docs/BUILD_NOTES.md): read lazily inside the handler, after the
// cron-secret check, so the job skips cleanly instead of crashing
// cold-start every 15 minutes while outreach isn't configured yet.
const OPTIONAL_VARS = ["ANTHROPIC_API_KEY"] as const;

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

  const missing = missingEnv(OPTIONAL_VARS);
  if (missing.length > 0) {
    logger.warn("job_skipped_not_configured", { missing });
    return jsonResponse({ skipped: "not_configured", missing }, { status: 200 });
  }
  const ANTHROPIC_API_KEY = requireEnv("ANTHROPIC_API_KEY");

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
