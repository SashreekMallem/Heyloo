// Deno entrypoint (excluded from ../tsconfig.json). Invoked by pg_cron
// (BACKEND_SPEC §8, `0 8 1 * *` — 1st of month) via pg_net.http_post.
import { timingSafeEqual } from "../_shared/crypto.ts";
import { getSql } from "../_shared/deno/db.ts";
import { requireEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { paypalBaseUrl } from "../_shared/providers/paypal.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { runReferralPayouts } from "./handler.ts";

const logger = createLogger({ fn: "job-referral-payouts" });
const CRON_SECRET = requireEnv("CRON_INVOKE_SECRET");
const PAYPAL_CLIENT_ID = requireEnv("PAYPAL_CLIENT_ID");
const PAYPAL_CLIENT_SECRET = requireEnv("PAYPAL_CLIENT_SECRET");
const PAYPAL_ENV = (Deno.env.get("PAYPAL_ENV") === "live" ? "live" : "sandbox") as
  | "live"
  | "sandbox";

Deno.serve(async (req: Request) => {
  const provided = req.headers.get("x-cron-secret");
  if (!provided || !timingSafeEqual(provided, CRON_SECRET)) {
    return jsonResponse({ error: "unauthorized" }, { status: 401 });
  }

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
