// Deno entrypoint (excluded from ../tsconfig.json). Invoked by pg_cron
// (NIGHTLY-1, `0 9 * * *` UTC) via pg_net.http_post — same
// x-cron-secret auth boundary as every other job-* function.
//
// Fast-ack then background pattern (CLAUDE.md Rule 2's webhook posture,
// reused here for the same reason: a multi-tenant Retell batch-test sweep
// can run well past the cron caller's own `net.http_post`
// `timeout_milliseconds` budget). `runInBackground` wraps
// `EdgeRuntime.waitUntil` (`_shared/deno/background.ts`) so the real work
// keeps running after this response is already sent.

import { timingSafeEqual } from "../_shared/crypto.ts";
import { runInBackground } from "../_shared/deno/background.ts";
import { getSql } from "../_shared/deno/db.ts";
import { requireEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { runAgentRegression } from "./handler.ts";

const logger = createLogger({ fn: "job-agent-regression" });
const CRON_SECRET = requireEnv("CRON_INVOKE_SECRET");
const SUPABASE_URL = requireEnv("SUPABASE_URL");
const PROVISION_INTERNAL_SECRET = requireEnv("PROVISION_INTERNAL_SECRET");

Deno.serve(async (req: Request) => {
  const provided = req.headers.get("x-cron-secret");
  if (!provided || !timingSafeEqual(provided, CRON_SECRET)) {
    return jsonResponse({ error: "unauthorized" }, { status: 401 });
  }

  const sql = getSql();

  runInBackground(
    async () => {
      const result = await runAgentRegression(sql, {
        fetchImpl: fetch,
        functionsBaseUrl: `${SUPABASE_URL}/functions/v1`,
        internalSecret: PROVISION_INTERNAL_SECRET,
        logger,
      });
      logger.info("job_agent_regression_complete", result);
    },
    (err) => logger.error("job_agent_regression_failed", { error: String(err) }),
  );

  return jsonResponse({ status: "started" });
});
