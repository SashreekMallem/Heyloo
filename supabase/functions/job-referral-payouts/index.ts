// Deno entrypoint (excluded from ../tsconfig.json). Invoked by pg_cron
// (BACKEND_SPEC §8, `0 8 1 * *` — 1st of month) via pg_net.http_post.
import { timingSafeEqual } from "../_shared/crypto.ts";
import { getSql } from "../_shared/deno/db.ts";
import { missingEnv, requireEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { paypalBaseUrl } from "../_shared/providers/paypal.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { runReferralPayouts } from "./handler.ts";

const logger = createLogger({ fn: "job-referral-payouts" });
const CRON_SECRET = requireEnv("CRON_INVOKE_SECRET");
// QA-1 BE-04: PayPal credentials are an OPTIONAL-integration secret. They were
// `requireEnv` at module scope, so an unset one crashed the isolate on every
// call (WORKER_ERROR 500, cron `0 8 1 * *`). They are read after the
// cron-secret check now; unset means an explicit `skipped: not_configured` 200
// (OPS-1 convention), never a payout attempt without credentials.
const PAYPAL_VARS = ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"] as const;
const PAYPAL_ENV = (Deno.env.get("PAYPAL_ENV") === "live" ? "live" : "sandbox") as
  | "live"
  | "sandbox";

Deno.serve(async (req: Request) => {
  const provided = req.headers.get("x-cron-secret");
  if (!provided || !timingSafeEqual(provided, CRON_SECRET)) {
    return jsonResponse({ error: "unauthorized" }, { status: 401 });
  }

  const missing = missingEnv(PAYPAL_VARS);
  if (missing.length > 0) {
    logger.warn("job_skipped_not_configured", { missing });
    return jsonResponse({ skipped: "not_configured", missing }, { status: 200 });
  }
  const PAYPAL_CLIENT_ID = requireEnv("PAYPAL_CLIENT_ID");
  const PAYPAL_CLIENT_SECRET = requireEnv("PAYPAL_CLIENT_SECRET");

  const sql = getSql();
  const result = await runReferralPayouts(sql, new Date(), {
    paypalFetch: fetch,
    paypalBaseUrl: paypalBaseUrl(PAYPAL_ENV),
    paypalClientId: PAYPAL_CLIENT_ID,
    paypalClientSecret: PAYPAL_CLIENT_SECRET,
    logger,
  });

  return jsonResponse(result);
});
