import type { StripeFetch } from "../_shared/providers/stripe.ts";
import { createBillingMeterEvent } from "../_shared/providers/stripe.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";

/**
 * Billing-cycle job (BACKEND_SPEC §8): for tenants whose billing period
 * just closed, reads `usage_daily`, computes overage against
 * `included_minutes`, reports usage to Stripe Billing Meters, generates a
 * `billing_invoices` row (idempotent on `unique(tenant_id, period_start,
 * period_end)`).
 *
 * VERIFY.md / BUILD_NOTES: BACKEND_SPEC's job table says invoicing is
 * "keyed off each tenant's billing anchor date" but no such anchor-date
 * column exists in the documented `tenants` schema (§1.1) — the natural
 * source is each tenant's Stripe subscription's own `current_period_end`,
 * which needs a live Stripe API read per tenant this job doesn't make
 * (kept out of the hot loop here). This implementation uses the simpler,
 * documented fallback of the closed PREVIOUS CALENDAR MONTH, gated by
 * `billing_invoices`'s own unique constraint so re-running the job is a
 * no-op once a period is invoiced — refine to true per-tenant anchor dates
 * once Stripe subscription data is read into a local column (flagged for
 * follow-up, not a T3 hot-path concern).
 */
/**
 * OPS (docs/BUILD_NOTES.md QA-BILL): Stripe is not configured on this
 * platform yet (no `STRIPE_SECRET_KEY`/`STRIPE_METER_EVENT_NAME` secret) —
 * both are optional here, matching the `api-checkout`/`webhooks-stripe`
 * SIGNUP-1/OPS-5 precedent of reading Stripe secrets with `optionalEnv`
 * rather than `requireEnv`, so this job never crashes cold-start. When
 * either is unset (or a tenant has no `stripe_customer_id` yet) the Stripe
 * Billing Meter report is skipped with a logged reason — the invoice row
 * below is still computed and written as `draft` either way (CLAUDE.md Rule
 * 4: "never mark anything paid, never crash"). Only `webhooks-stripe`'s
 * `invoice.paid` handler ever flips a `billing_invoices` row to `paid`.
 */
export interface BillingCycleDeps {
  stripeFetch: StripeFetch;
  stripeSecretKey: string | undefined;
  billingMeterEventName: string | undefined;
  logger: Logger;
}

interface TenantBillingRow {
  tenant_id: string;
  stripe_customer_id: string | null;
  vertical: string;
  price_version: string;
  base_cents: number;
  included_minutes: number;
  overage_cents_per_minute: number;
  billable_minutes: number;
}

export function previousCalendarMonth(now: Date): { periodStart: string; periodEnd: string } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-based; previous month is month-1
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return {
    periodStart: start.toISOString().slice(0, 10),
    periodEnd: end.toISOString().slice(0, 10),
  };
}

export async function findTenantsForBilling(
  sql: SqlClient,
  periodStart: string,
  periodEnd: string,
): Promise<TenantBillingRow[]> {
  return sql<TenantBillingRow>`
    select
      t.id as tenant_id,
      t.stripe_customer_id,
      t.vertical,
      t.price_version,
      (pc.value->>'base_cents')::int as base_cents,
      (pc.value->>'included_minutes')::numeric as included_minutes,
      (pc.value->>'overage_cents')::numeric as overage_cents_per_minute,
      coalesce((
        select sum(ud.billable_minutes) from public.usage_daily ud
        where ud.tenant_id = t.id and ud.date >= ${periodStart}::date and ud.date < ${periodEnd}::date
      ), 0) as billable_minutes
    from public.tenants t
    join public.platform_settings pc on pc.key = 'price_card_' || t.vertical
    where t.deleted_at is null
      and t.status in ('active', 'past_due')
      and not exists (
        select 1 from public.billing_invoices bi
        where bi.tenant_id = t.id and bi.period_start = ${periodStart}::date and bi.period_end = ${periodEnd}::date
      )
  `;
}

/**
 * Pure invoice-amount calculation (plan base fee + rounded per-minute
 * overage, integer cents) — reachable and independently testable with NO
 * Stripe call in the loop (CLAUDE.md Rule 2 "money in integer cents";
 * QA-BILL deliverable 2: proven directly against a hand calculation from
 * `platform_settings.price_card_<vertical>`, not only via the Stripe-gated
 * path below).
 */
export interface InvoiceAmountInputs {
  base_cents: number;
  included_minutes: number;
  overage_cents_per_minute: number;
  billable_minutes: number;
}

export interface InvoiceAmounts {
  overageMinutes: number;
  overageCents: number;
  totalCents: number;
}

export function computeInvoiceAmounts(row: InvoiceAmountInputs): InvoiceAmounts {
  const overageMinutes = Math.max(0, row.billable_minutes - row.included_minutes);
  const overageCents = Math.round(overageMinutes * row.overage_cents_per_minute);
  const totalCents = row.base_cents + overageCents;
  return { overageMinutes, overageCents, totalCents };
}

export async function billOneTenant(
  sql: SqlClient,
  row: TenantBillingRow,
  periodStart: string,
  periodEnd: string,
  deps: BillingCycleDeps,
): Promise<boolean> {
  const { overageMinutes, overageCents, totalCents } = computeInvoiceAmounts(row);

  if (row.stripe_customer_id && deps.stripeSecretKey && deps.billingMeterEventName) {
    const meterResult = await createBillingMeterEvent(deps.stripeFetch, deps.stripeSecretKey, {
      eventName: deps.billingMeterEventName,
      stripeCustomerId: row.stripe_customer_id,
      value: row.billable_minutes,
      identifier: `${row.tenant_id}:${periodStart}:${periodEnd}`,
    });
    if (!meterResult.ok) {
      deps.logger.error("billing_cycle_meter_event_failed", {
        tenant_id: row.tenant_id,
        status: meterResult.status,
      });
      // Financial-integrity risk (BACKEND_SPEC §8) — still write the
      // invoice row below so a draft exists rather than nothing at all;
      // the meter-event failure is separately alertable via
      // `billing.meter_event.error` webhooks (§7.4).
    }
  } else if (row.stripe_customer_id) {
    // Stripe not configured on this platform yet (OPS, docs/BUILD_NOTES.md
    // QA-BILL) — skip the meter-event report, never crash, still write the
    // draft invoice below so billing math keeps accruing correctly and can
    // be back-reported to Stripe once the secret is provisioned.
    deps.logger.warn("billing_cycle_meter_event_skipped_not_configured", {
      tenant_id: row.tenant_id,
    });
  }

  const inserted = await sql<{ id: string }>`
    insert into public.billing_invoices (
      tenant_id, period_start, period_end, base_fee_cents, included_minutes,
      overage_minutes, overage_cents, total_cents, status
    ) values (
      ${row.tenant_id}, ${periodStart}::date, ${periodEnd}::date, ${row.base_cents}, ${row.included_minutes},
      ${overageMinutes}, ${overageCents}, ${totalCents}, 'draft'
    )
    on conflict (tenant_id, period_start, period_end) do nothing
    returning id
  `;
  return inserted.length > 0;
}
