import type { StripeFetch } from "../_shared/providers/stripe.ts";
import { createBillingMeterEvent, createInvoiceItem } from "../_shared/providers/stripe.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";

/**
 * Billing-cycle job (BACKEND_SPEC §8): for tenants whose billing period
 * just closed, reads `usage_daily`, computes overage against
 * `included_minutes`, reports usage to Stripe Billing Meters, generates a
 * `billing_invoices` row (idempotent on `unique(tenant_id, period_start,
 * period_end)`).
 *
 * BEHAVIOR-billing: what is reported to Stripe is the OVERAGE only (the metered
 * price is the per-minute overage rate, BILL-2), as a plain decimal Stripe
 * accepts (BILL-1), stamped inside the period (BILL-12); text-reply overage is
 * billed as an invoice item (BILL-4). Both reports are recorded on the invoice
 * row and retried until they succeed, never dropped.
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
  /** AI text replies sent in the period (`usage_daily.text_messages_out`) and the
   * plan's text allowance / per-reply overage (BILL-4). Optional so a caller that
   * only knows voice usage keeps working (no text overage). */
  text_messages_out?: number;
  included_text_conversations?: number;
  text_overage_cents_per_message?: number;
  /** True when Stripe already issued an invoice whose service period overlaps
   * the period being billed (SIGNUP-BILL-FIX D): the Stripe invoice, written by
   * `webhooks-stripe` on `invoice.paid`, is the revenue record, so this job must
   * not add a second, competing draft for the same money. */
  stripe_invoiced?: boolean;
  /** Set when a local invoice row for this period already exists but its Stripe
   * report (meter event / text invoice item) has not fully succeeded yet: the job
   * finishes the missing report instead of inserting again. */
  pending_invoice_id?: string | null;
  pending_meter_reported?: boolean;
  pending_text_reported?: boolean;
  pending_overage_minutes?: number | string | null;
  pending_text_overage_cents?: number | null;
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
  // Voice minutes are summed straight from `usage_events` over the tenant-LOCAL
  // period (BILL-7): `usage_daily` lags the rollup and used to bucket by UTC date,
  // so the last local day of the month was missing from a US tenant's invoice.
  // `is_billable` already excludes test calls. Rounded to 6 decimals (BILL-12).
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
        select round(sum(ue.minutes), 6) from public.usage_events ue
        where ue.tenant_id = t.id and ue.is_billable
          and ue.occurred_at >= (${periodStart}::date::timestamp at time zone t.timezone)
          and ue.occurred_at < (${periodEnd}::date::timestamp at time zone t.timezone)
      ), 0) as billable_minutes,
      coalesce((
        select sum(ud.text_messages_out) from public.usage_daily ud
        where ud.tenant_id = t.id and ud.date >= ${periodStart}::date and ud.date < ${periodEnd}::date
      ), 0)::int as text_messages_out,
      coalesce((pc.value->>'included_text_conversations')::numeric, 0)::int as included_text_conversations,
      coalesce((pc.value->>'text_conversation_overage_cents')::numeric, 0)::int as text_overage_cents_per_message,
      exists (
        select 1 from public.billing_invoices si
        where si.tenant_id = t.id and si.stripe_invoice_id is not null
          and si.period_end > si.period_start
          and si.period_start < ${periodEnd}::date and si.period_end > ${periodStart}::date
      ) as stripe_invoiced,
      li.id as pending_invoice_id,
      (li.meter_reported_at is not null) as pending_meter_reported,
      (li.text_overage_item_id is not null) as pending_text_reported,
      li.overage_minutes as pending_overage_minutes,
      li.text_overage_cents as pending_text_overage_cents
    from public.tenants t
    join public.platform_settings pc on pc.key = 'price_card_' || t.vertical
    left join public.billing_invoices li
      on li.tenant_id = t.id and li.stripe_invoice_id is null
      and li.period_start = ${periodStart}::date and li.period_end = ${periodEnd}::date
    where t.deleted_at is null
      and coalesce(t.is_test, false) = false
      and t.created_at < ${periodEnd}::date
      and (
        t.status in ('active', 'past_due')
        or (t.status = 'canceled' and t.canceled_at >= ${periodStart}::date)
      )
      and (li.id is null or li.stripe_report_pending)
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
  text_messages_out?: number;
  included_text_conversations?: number;
  text_overage_cents_per_message?: number;
}

export interface InvoiceAmounts {
  /** Minutes beyond the allowance, rounded to 6 decimals: the value the Stripe
   * meter is sent (its price is the per-minute overage rate). */
  overageMinutes: number;
  overageCents: number;
  /** AI text replies beyond the allowance x the per-reply overage (integer cents). */
  textOverageCents: number;
  totalCents: number;
}

/** Postgres `numeric` reaches JS as a string; drift beyond 6 decimals is noise. */
export function roundMinutes(value: number | string): number {
  const n = Number(value);
  return Math.round(n * 1e6) / 1e6;
}

export function computeInvoiceAmounts(row: InvoiceAmountInputs): InvoiceAmounts {
  const overageMinutes = roundMinutes(
    Math.max(0, roundMinutes(row.billable_minutes) - Number(row.included_minutes)),
  );
  const overageCents = Math.round(overageMinutes * Number(row.overage_cents_per_minute));
  const overText = Math.max(
    0,
    Number(row.text_messages_out ?? 0) - Number(row.included_text_conversations ?? 0),
  );
  const textOverageCents = Math.round(overText * Number(row.text_overage_cents_per_message ?? 0));
  const totalCents = Number(row.base_cents) + overageCents + textOverageCents;
  return { overageMinutes, overageCents, textOverageCents, totalCents };
}

/** Last second of the billed period (Unix seconds, UTC): a meter event stamped
 * here belongs to the period, not to whenever the job happened to run, and stays
 * inside Stripe's 35-day window for every daily retry until the next period. */
function periodEndTimestamp(periodEnd: string): number {
  return Math.floor(Date.parse(`${periodEnd}T00:00:00Z`) / 1000) - 1;
}

async function raiseReportAlert(
  sql: SqlClient,
  row: TenantBillingRow,
  periodStart: string,
  periodEnd: string,
  what: "meter_event" | "text_overage_item",
  status: number,
): Promise<void> {
  await sql`
    insert into public.alerts (rule, severity, tenant_id, payload)
    select 'billing_report_failed', 'critical', ${row.tenant_id},
      ${{ what, status, period_start: periodStart, period_end: periodEnd }}::jsonb
    where not exists (
      select 1 from public.alerts a
      where a.rule = 'billing_report_failed' and a.tenant_id = ${row.tenant_id}
        and a.status = 'open' and a.payload->>'what' = ${what}
        and a.payload->>'period_start' = ${periodStart}
    )
  `;
}

export async function billOneTenant(
  sql: SqlClient,
  row: TenantBillingRow,
  periodStart: string,
  periodEnd: string,
  deps: BillingCycleDeps,
): Promise<boolean> {
  const computed = computeInvoiceAmounts(row);
  const retrying = Boolean(row.pending_invoice_id);
  // A retry reports exactly what was stored on the invoice row, not a recomputation.
  const overageMinutes = retrying
    ? roundMinutes(row.pending_overage_minutes ?? 0)
    : computed.overageMinutes;
  const textOverageCents = retrying
    ? Number(row.pending_text_overage_cents ?? 0)
    : computed.textOverageCents;
  const { overageCents, totalCents } = computed;

  const hasCustomer = Boolean(row.stripe_customer_id);
  const meterDue = overageMinutes > 0 && !row.pending_meter_reported;
  const textDue = textOverageCents > 0 && !row.pending_text_reported;
  // Anything Stripe still has to hear about keeps the row `pending` so the next
  // run retries it (also while Stripe is not configured yet: it is back-reported
  // once the secrets exist).
  const reportPending = hasCustomer && (meterDue || textDue);

  let invoiceId = row.pending_invoice_id ?? null;
  let created = false;
  if (!invoiceId) {
    // Stripe already invoiced this period (its own invoice row carries the
    // revenue): keep our usage computation as a `void` marker so the tenant is
    // not re-processed on every daily run, but never as a draft/paid receivable
    // that would double the revenue.
    const status = row.stripe_invoiced ? "void" : "draft";
    const inserted = await sql<{ id: string }>`
      insert into public.billing_invoices (
        tenant_id, period_start, period_end, base_fee_cents, included_minutes,
        overage_minutes, overage_cents, text_overage_cents, text_messages_billed,
        total_cents, status, stripe_report_pending
      ) values (
        ${row.tenant_id}, ${periodStart}::date, ${periodEnd}::date, ${row.base_cents}, ${row.included_minutes},
        ${overageMinutes}, ${overageCents}, ${textOverageCents}, ${Number(row.text_messages_out ?? 0)},
        ${totalCents}, ${status}, ${reportPending}
      )
      on conflict (tenant_id, period_start, period_end) where stripe_invoice_id is null do nothing
      returning id
    `;
    invoiceId = inserted[0]?.id ?? null;
    if (!invoiceId) return false; // already written by a concurrent/previous run
    created = true;
    if (row.stripe_invoiced) {
      deps.logger.info("billing_cycle_period_already_invoiced_by_stripe", {
        tenant_id: row.tenant_id,
        period_start: periodStart,
      });
    }
  }

  if (!reportPending) return true;

  if (!deps.stripeSecretKey) {
    // Stripe not configured on this platform yet (OPS, docs/BUILD_NOTES.md QA-BILL):
    // never crash; the row stays pending and is back-reported once the secrets exist.
    deps.logger.warn("billing_cycle_meter_event_skipped_not_configured", {
      tenant_id: row.tenant_id,
    });
    return created;
  }

  let failed = false;

  if (meterDue && !deps.billingMeterEventName) {
    deps.logger.warn("billing_cycle_meter_event_skipped_not_configured", {
      tenant_id: row.tenant_id,
    });
    failed = true;
  } else if (meterDue) {
    const meterResult = await createBillingMeterEvent(deps.stripeFetch, deps.stripeSecretKey, {
      eventName: deps.billingMeterEventName as string,
      stripeCustomerId: row.stripe_customer_id as string,
      value: overageMinutes,
      identifier: `${row.tenant_id}:${periodStart}:${periodEnd}`,
      timestamp: periodEndTimestamp(periodEnd),
    });
    if (meterResult.ok) {
      await sql`update public.billing_invoices set meter_reported_at = now() where id = ${invoiceId}`;
    } else {
      failed = true;
      deps.logger.error("billing_cycle_meter_event_failed", {
        tenant_id: row.tenant_id,
        status: meterResult.status,
      });
      await raiseReportAlert(sql, row, periodStart, periodEnd, "meter_event", meterResult.status);
    }
  }

  if (textDue) {
    const itemResult = await createInvoiceItem(deps.stripeFetch, deps.stripeSecretKey, {
      customerId: row.stripe_customer_id as string,
      amountCents: textOverageCents,
      currency: "usd",
      description: `AI text replies beyond plan, ${periodStart} to ${periodEnd}`,
      periodStart: Math.floor(Date.parse(`${periodStart}T00:00:00Z`) / 1000),
      periodEnd: periodEndTimestamp(periodEnd),
      metadata: {
        tenant_id: row.tenant_id,
        kind: "text_overage",
        period_start: periodStart,
        period_end: periodEnd,
      },
      idempotencyKey: `text-overage:${row.tenant_id}:${periodStart}:${periodEnd}`,
    });
    const itemId = (itemResult.body as { id?: string } | undefined)?.id;
    if (itemResult.ok && itemId) {
      await sql`update public.billing_invoices set text_overage_item_id = ${itemId} where id = ${invoiceId}`;
    } else {
      failed = true;
      deps.logger.error("billing_cycle_text_overage_item_failed", {
        tenant_id: row.tenant_id,
        status: itemResult.status,
      });
      await raiseReportAlert(
        sql,
        row,
        periodStart,
        periodEnd,
        "text_overage_item",
        itemResult.status,
      );
    }
  }

  if (!failed) {
    await sql`update public.billing_invoices set stripe_report_pending = false where id = ${invoiceId}`;
  }
  return created || !failed;
}
