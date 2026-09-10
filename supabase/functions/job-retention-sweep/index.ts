// Deno entrypoint (excluded from ../tsconfig.json). Invoked by pg_cron
// (BACKEND_SPEC §8 "Retention sweep", `0 5 * * *`) via pg_net.http_post.
import { timingSafeEqual } from "../_shared/crypto.ts";
import { getSql } from "../_shared/deno/db.ts";
import { requireEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { runRetentionSweep } from "./handler.ts";

const logger = createLogger({ fn: "job-retention-sweep" });
const CRON_SECRET = requireEnv("CRON_INVOKE_SECRET");
const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SB_SECRET_KEY = requireEnv("SB_SECRET_KEY");

/** Bulk delete (Supabase Storage `DELETE /object/{bucket}` + `{prefixes}}`
 * body — confirmed against the installed `@supabase/storage-js` v2.116.0
 * source's `remove()`, docs/VERIFY.md). `paths` are already bucket-relative
 * (handler.ts strips the `recordings/` prefix stored in the DB column). */
async function removeFromStorage(paths: string[]): Promise<boolean> {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/recordings`, {
    method: "DELETE",
    headers: {
      authorization: `Bearer ${SB_SECRET_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ prefixes: paths }),
  });
  return res.ok;
}

Deno.serve(async (req: Request) => {
  const provided = req.headers.get("x-cron-secret");
  if (!provided || !timingSafeEqual(provided, CRON_SECRET)) {
    return jsonResponse({ error: "unauthorized" }, { status: 401 });
  }

  const sql = getSql();
  const result = await runRetentionSweep(sql, new Date(), { removeFromStorage });
  logger.info("job_retention_sweep_complete", result);
  return jsonResponse(result);
});
