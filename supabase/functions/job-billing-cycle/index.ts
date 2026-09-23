// Deno entrypoint (excluded from ../tsconfig.json). Invoked by pg_cron
// (BACKEND_SPEC §8, `0 1 * * *`) via pg_net.http_post.
import { timingSafeEqual } from "../_shared/crypto.ts";
import { getSql } from "../_shared/deno/db.ts";
import { optionalEnv, requireEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { billOneTenant, findTenantsForBilling, previousCalendarMonth } from "./handler.ts";

const logger = createLogger({ fn: "job-billing-cycle" });
const CRON_SECRET = requireEnv("CRON_INVOKE_SECRET");
// OPS-5/SIGNUP-1 precedent (docs/BUILD_NOTES.md, `webhooks-stripe`/
// `api-checkout`): Stripe is not provisioned on this platform yet.
// `requireEnv` throws at Deno cold-start, which crashed EVERY invocation of
// this job with an opaque WORKER_ERROR before the invoice math below ever
// ran (QA-BILL live finding, 2026-09-23) — read optionally instead so the
// job still computes/writes `billing_invoices` rows (never Stripe calls,
// never marks anything paid) and only skips the Stripe Billing Meter report
// per tenant (see handler.ts `billOneTenant`'s own not-configured branch).
const STRIPE_SECRET_KEY = optionalEnv("STRIPE_SECRET_KEY");
const STRIPE_METER_EVENT_NAME = optionalEnv("STRIPE_METER_EVENT_NAME");

Deno.serve(async (req: Request) => {
  const provided = req.headers.get("x-cron-secret");
  if (!provided || !timingSafeEqual(provided, CRON_SECRET)) {
    return jsonResponse({ error: "unauthorized" }, { status: 401 });
  }

  const missingStripe = [
    ...(STRIPE_SECRET_KEY ? [] : ["STRIPE_SECRET_KEY"]),
    ...(STRIPE_METER_EVENT_NAME ? [] : ["STRIPE_METER_EVENT_NAME"]),
  ];
  if (missingStripe.length > 0) {
    logger.warn("job_billing_cycle_stripe_not_configured", { missing: missingStripe });
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
    ...(missingStripe.length > 0
      ? { stripe_meter_reporting: "skipped_not_configured", missing: missingStripe }
      : {}),
  });
});
