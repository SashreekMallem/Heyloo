// Deno entrypoint (excluded from ../tsconfig.json). Invoked by the
// pg_cron "Queue worker poll" job (BACKEND_SPEC §8, every minute) via
// pg_net.http_post — verify_jwt false, auth is a shared cron secret header
// (this function is never meant to be internet-facing-useful; the secret
// just keeps it from being invoked by anything other than the cron job).

import { timingSafeEqual } from "../_shared/crypto.ts";
import { getSql } from "../_shared/deno/db.ts";
import { requireEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { buildOutboundDeps } from "./deps.ts";
import { runOutboundWorker, sweepNotConfiguredOutbound } from "./handler.ts";

const logger = createLogger({ fn: "worker-messages-outbound" });
const CRON_SECRET = requireEnv("CRON_INVOKE_SECRET");
// MESSAGING-1 / OPS-1: messaging providers are OPTIONAL integrations —
// checked after the cron-secret auth check, never at module scope, so a
// deploy with none configured returns `skipped: "not_configured"` instead
// of crashing cold start. Any ONE provider (e.g. email only) is enough.
const OUTBOUND = buildOutboundDeps((name) => Deno.env.get(name), fetch, logger);

Deno.serve(async (req: Request) => {
  const provided = req.headers.get("x-cron-secret");
  if (!provided || !timingSafeEqual(provided, CRON_SECRET)) {
    return jsonResponse({ error: "unauthorized" }, { status: 401 });
  }

  if (!OUTBOUND.configured) {
    logger.warn("job_skipped_not_configured", { missing: OUTBOUND.missing });
    // OPS-8: still runs the bounded, read_ct-free stale sweep so a manual
    // invoke behaves identically to worker-tick's own not-configured leg.
    const parked = await sweepNotConfiguredOutbound(getSql());
    return jsonResponse(
      { skipped: "not_configured", missing: OUTBOUND.missing, parked },
      { status: 200 },
    );
  }

  const result = await runOutboundWorker(getSql(), OUTBOUND.deps);
  return jsonResponse(result);
});
