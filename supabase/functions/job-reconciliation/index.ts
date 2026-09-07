// Deno entrypoint (excluded from ../tsconfig.json). Invoked by pg_cron
// (BACKEND_SPEC §8, `0 3 * * *`) via pg_net.http_post.
import { timingSafeEqual } from "../_shared/crypto.js";
import { getSql } from "../_shared/deno/db.js";
import { requireEnv } from "../_shared/deno/env.js";
import { createLogger } from "../_shared/logger.js";
import { jsonResponse } from "../_shared/responses.js";
import { findStaleCalls, reconcileOneCall } from "./handler.js";

const logger = createLogger({ fn: "job-reconciliation" });
const CRON_SECRET = requireEnv("CRON_INVOKE_SECRET");
const RETELL_API_KEY = requireEnv("RETELL_API_KEY");

Deno.serve(async (req: Request) => {
  const provided = req.headers.get("x-cron-secret");
  if (!provided || !timingSafeEqual(provided, CRON_SECRET)) {
    return jsonResponse({ error: "unauthorized" }, { status: 401 });
  }

  const sql = getSql();
  const stale = await findStaleCalls(sql);

  let reconciled = 0;
  let failed = 0;
  for (const row of stale) {
    const ok = await reconcileOneCall(sql, row, {
      retellFetch: fetch,
      retellApiKey: RETELL_API_KEY,
      logger,
    });
    if (ok) reconciled += 1;
    else failed += 1;
  }

  logger.info("job_reconciliation_complete", { reconciled, failed, total: stale.length });
  return jsonResponse({ reconciled, failed, total: stale.length });
});
