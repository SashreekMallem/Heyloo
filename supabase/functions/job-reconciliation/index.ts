// Deno entrypoint (excluded from ../tsconfig.json). Invoked by pg_cron
// (BACKEND_SPEC §8, `0 3 * * *`) via pg_net.http_post.
import { timingSafeEqual } from "../_shared/crypto.ts";
import { getSql } from "../_shared/deno/db.ts";
import { requireEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { findStaleCalls, reconcileOneCall } from "./handler.ts";

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
