// Deno entrypoint (excluded from ../tsconfig.json). Invoked by pg_cron
// (BACKEND_SPEC §8, `0 1 * * *`) via pg_net.http_post.
import { timingSafeEqual } from "../_shared/crypto.ts";
import { getSql } from "../_shared/deno/db.ts";
import { requireEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { billOneTenant, findTenantsForBilling, previousCalendarMonth } from "./handler.ts";

const logger = createLogger({ fn: "job-billing-cycle" });
const CRON_SECRET = requireEnv("CRON_INVOKE_SECRET");
const STRIPE_SECRET_KEY = requireEnv("STRIPE_SECRET_KEY");
const STRIPE_METER_EVENT_NAME = requireEnv("STRIPE_METER_EVENT_NAME");

Deno.serve(async (req: Request) => {
  const provided = req.headers.get("x-cron-secret");
  if (!provided || !timingSafeEqual(provided, CRON_SECRET)) {
    return jsonResponse({ error: "unauthorized" }, { status: 401 });
  }

  const sql = getSql();
  const { periodStart, periodEnd } = previousCalendarMonth(new Date());
  const tenants = await findTenantsForBilling(sql, periodStart, periodEnd);

  let invoiced = 0;
  for (const row of tenants) {
    const ok = await billOneTenant(sql, row, periodStart, periodEnd, {
      stripeFetch: fetch,
      stripeSecretKey: STRIPE_SECRET_KEY,
      billingMeterEventName: STRIPE_METER_EVENT_NAME,
      logger,
    });
    if (ok) invoiced += 1;
  }

  logger.info("job_billing_cycle_complete", {
    period_start: periodStart,
    period_end: periodEnd,
    invoiced,
    total: tenants.length,
  });
  return jsonResponse({
    period_start: periodStart,
    period_end: periodEnd,
    invoiced,
    total: tenants.length,
  });
});
