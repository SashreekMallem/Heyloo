// Deno entrypoint (excluded from ../tsconfig.json). Invoked every 3 minutes
// by pg_cron (BACKEND_SPEC §8 "Keep-warm ping") via pg_net.http_post.
import { timingSafeEqual } from "../_shared/crypto.ts";
import { requireEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { runKeepWarmPing } from "./handler.ts";

const logger = createLogger({ fn: "job-keep-warm" });
const CRON_SECRET = requireEnv("CRON_INVOKE_SECRET");
const SUPABASE_URL = requireEnv("SUPABASE_URL");
const RETELL_WEBHOOK_SIGNING_SECRET = requireEnv("RETELL_WEBHOOK_SIGNING_SECRET");

Deno.serve(async (req: Request) => {
  const provided = req.headers.get("x-cron-secret");
  if (!provided || !timingSafeEqual(provided, CRON_SECRET)) {
    return jsonResponse({ error: "unauthorized" }, { status: 401 });
  }

  const outcomes = await runKeepWarmPing({
    fetchImpl: fetch,
    supabaseUrl: SUPABASE_URL,
    retellWebhookSigningSecret: RETELL_WEBHOOK_SIGNING_SECRET,
    logger,
  });

  logger.info("job_keep_warm_complete", { outcomes });
  return jsonResponse({ outcomes });
});
