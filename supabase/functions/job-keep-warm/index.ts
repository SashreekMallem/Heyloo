// Deno entrypoint (excluded from ../tsconfig.json). Invoked every 3 minutes
// by pg_cron (BACKEND_SPEC §8 "Keep-warm ping") via pg_net.http_post.
import { timingSafeEqual } from "../_shared/crypto.ts";
import { missingEnv, requireEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { runKeepWarmPing } from "./handler.ts";

const logger = createLogger({ fn: "job-keep-warm" });
const CRON_SECRET = requireEnv("CRON_INVOKE_SECRET");
const SUPABASE_URL = requireEnv("SUPABASE_URL");

// RETELL_WEBHOOK_SIGNING_SECRET is an optional integration secret (OPS-1,
// docs/BUILD_NOTES.md): read lazily inside the handler, after the
// cron-secret check, so a not-yet-configured Retell account skips cleanly
// instead of crashing cold-start every 3 minutes.
const OPTIONAL_VARS = ["RETELL_WEBHOOK_SIGNING_SECRET"] as const;

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
  const RETELL_WEBHOOK_SIGNING_SECRET = requireEnv("RETELL_WEBHOOK_SIGNING_SECRET");

  const outcomes = await runKeepWarmPing({
    fetchImpl: fetch,
    supabaseUrl: SUPABASE_URL,
    retellWebhookSigningSecret: RETELL_WEBHOOK_SIGNING_SECRET,
    logger,
  });

  logger.info("job_keep_warm_complete", { outcomes });
  return jsonResponse({ outcomes });
});
