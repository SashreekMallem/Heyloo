import type { Logger, SqlClient } from "../_shared/types.ts";

/**
 * Stripe invoice + charge -> `billing_invoices` / `payment_processing_events`
 * (SIGNUP-BILL-FIX D/E). Pure DB effects plus one injected Stripe read, so it
 * stays unit-testable with a fake `sql`.
 *
 * Field names verified against the CURRENT Stripe API reference (fetched
 * 2026-09-29, docs/VERIFY.md SIGNUP-BILL-FIX):
 *  - Invoice: `id`, `customer`, `status`, `amount_paid`, `amount_due`,
 *    `total`, `subtotal`, `total_discount_amounts[].amount`, `currency`,
 *    `period_start`/`period_end`, `lines.data[]`, and — since API version
 *    2025-03-31.basil — the subscription lives at
 *    `parent.subscription_details.subscription` with the subscription's
 *    metadata snapshot at `parent.subscription_details.metadata` (older API
 *    versions: top-level `subscription` and `subscription_details.metadata`;
 *    both are read so an endpoint on either version works).
 *  - Invoice line item: `period.start`/`period.end` (unix seconds),
 *    `metadata`, `parent.type`.
 *  - Charge: `id`, `customer`, `balance_transaction` (a string id unless
 *    expanded), `status`, `created`, `payment_method_details.type`. A Charge
 *    carries NO invoice or subscription metadata, so a charge that arrives
 *    before the tenant has its `stripe_customer_id` cannot be attributed
 *    from its own payload; it is deferred and replayed (see below).
 *  - BalanceTransaction: `fee` and `net` are integers in the smallest
 *    currency unit (cents for USD).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Rec = Record<string, unknown>;

function rec(value: unknown): Rec | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Rec)
    : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function cents(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function isoDate(unixSeconds: unknown): string | null {
  if (typeof unixSeconds !== "number" || !Number.isFinite(unixSeconds) || unixSeconds <= 0) {
    return null;
  }
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

/** Thrown by `processStripeEvent` when an event cannot be fully processed YET
 * (tenant not linked to the Stripe customer, fee not fetchable). The Deno
 * entrypoint records `message` in `webhook_events.processing_error`
 * (`deferred:<reason>`); the event is replayed by `replayDeferredCharges`. */
export class StripeEventDeferred extends Error {
  constructor(readonly reason: string) {
    super(`deferred:${reason}`);
    this.name = "StripeEventDeferred";
  }
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

export interface InvoiceFacts {
  invoiceId: string;
  customerId: string | null;
  subscriptionId: string | null;
  /** Every `tenant_id` found in metadata (subscription snapshot, invoice, lines), in priority order. */
  metadataTenantIds: string[];
  periodStart: string;
  periodEnd: string;
  amountPaidCents: number;
  amountDueCents: number;
  totalCents: number;
  subtotalCents: number;
  discountCents: number;
  currency: string | null;
}

function tenantIdFromMetadata(meta: unknown): string | null {
  const id = str(rec(meta)?.["tenant_id"]);
  return id && UUID_RE.test(id) ? id : null;
}

/** Service period of an invoice: the recurring (subscription) line's period —
 * `lines.data[0].period` for a plain subscription invoice — falling back to
 * the first line, then the invoice's own `period_start`/`period_end`. A
 * one-time setup-fee line has a zero-length period, so a subscription line
 * with a real span wins. */
export function invoicePeriod(invoice: Rec): { start: string; end: string } | null {
  const lines = Array.isArray(rec(invoice["lines"])?.["data"])
    ? (rec(invoice["lines"])?.["data"] as unknown[])
    : [];
  const periodOf = (line: unknown) => {
    const p = rec(rec(line)?.["period"]);
    const start = isoDate(p?.["start"]);
    const end = isoDate(p?.["end"]);
    return start && end ? { start, end } : null;
  };
  const isSubscriptionLine = (line: unknown) => {
    const parent = rec(rec(line)?.["parent"]);
    return (
      parent?.["type"] === "subscription_item_details" ||
      str(rec(line)?.["subscription"]) !== null ||
      rec(line)?.["type"] === "subscription"
    );
  };
  const spanning = lines.find((l) => {
    const p = periodOf(l);
    return p !== null && p.end > p.start && isSubscriptionLine(l);
  });
  const chosen = (spanning ? periodOf(spanning) : null) ?? (lines[0] ? periodOf(lines[0]) : null);
  if (chosen) return chosen;
  const start = isoDate(invoice["period_start"]);
  const end = isoDate(invoice["period_end"]);
  return start && end ? { start, end } : null;
}

export function parseInvoice(obj: Rec): InvoiceFacts | null {
  const invoiceId = str(obj["id"]);
  if (!invoiceId) return null;
  const period = invoicePeriod(obj);
  if (!period) return null;

  const parent = rec(rec(obj["parent"])?.["subscription_details"]);
  const legacyDetails = rec(obj["subscription_details"]);
  const subscriptionId =
    str(parent?.["subscription"]) ??
    str(obj["subscription"]) ??
    str(legacyDetails?.["subscription"]);

  const lines = Array.isArray(rec(obj["lines"])?.["data"])
    ? (rec(obj["lines"])?.["data"] as unknown[])
    : [];
  const metadataTenantIds = [
    tenantIdFromMetadata(parent?.["metadata"]),
    tenantIdFromMetadata(legacyDetails?.["metadata"]),
    tenantIdFromMetadata(obj["metadata"]),
    ...lines.map((l) => tenantIdFromMetadata(rec(l)?.["metadata"])),
  ].filter((id, i, all): id is string => id !== null && all.indexOf(id) === i);

  const discounts = Array.isArray(obj["total_discount_amounts"])
    ? (obj["total_discount_amounts"] as unknown[])
    : [];
  const discountCents = discounts.reduce<number>(
    (sum, d) => sum + (cents(rec(d)?.["amount"]) ?? 0),
    0,
  );

  const total = cents(obj["total"]) ?? cents(obj["amount_due"]) ?? 0;
  return {
    invoiceId,
    customerId: str(obj["customer"]),
    subscriptionId,
    metadataTenantIds,
    periodStart: period.start,
    periodEnd: period.end,
    amountPaidCents: cents(obj["amount_paid"]) ?? 0,
    amountDueCents: cents(obj["amount_due"]) ?? total,
    totalCents: total,
    subtotalCents: cents(obj["subtotal"]) ?? total,
    discountCents,
    currency: str(obj["currency"]),
  };
}

export interface ResolvedTenant {
  tenantId: string;
  /** True when the tenant row was found by something other than
   * `stripe_customer_id`, i.e. the customer/subscription ids still need to be
   * linked (the invoice beat `checkout.session.completed`). */
  needsLink: boolean;
}

/** Tenant for an invoice: by Stripe customer, else by the `tenant_id` we put in
 * the subscription metadata at Checkout, else by subscription id. */
export async function resolveInvoiceTenant(
  sql: SqlClient,
  facts: InvoiceFacts,
): Promise<ResolvedTenant | null> {
  if (facts.customerId) {
    const rows = await sql<{ id: string }>`
      select id from public.tenants where stripe_customer_id = ${facts.customerId} limit 1
    `;
    if (rows[0]) return { tenantId: rows[0].id, needsLink: false };
  }
  for (const candidate of facts.metadataTenantIds) {
    const rows = await sql<{ id: string }>`
      select id from public.tenants where id = ${candidate}::uuid limit 1
    `;
    if (rows[0]) return { tenantId: rows[0].id, needsLink: true };
  }
  if (facts.subscriptionId) {
    const rows = await sql<{ id: string }>`
      select id from public.tenants where stripe_subscription_id = ${facts.subscriptionId} limit 1
    `;
    if (rows[0]) return { tenantId: rows[0].id, needsLink: true };
  }
  return null;
}

/** Links a tenant found by fallback to its Stripe customer/subscription (never
 * overwrites an existing link). */
export async function linkTenantToStripe(
  sql: SqlClient,
  tenantId: string,
  customerId: string | null,
  subscriptionId: string | null,
): Promise<void> {
  if (!customerId && !subscriptionId) return;
  await sql`
    update public.tenants
    set stripe_customer_id = coalesce(stripe_customer_id, ${customerId}),
        stripe_subscription_id = coalesce(stripe_subscription_id, ${subscriptionId})
    where id = ${tenantId}
  `;
}

export type InvoiceRowStatus = "paid" | "past_due";

/** Upserts the `billing_invoices` row for a Stripe invoice (idempotent on
 * `stripe_invoice_id`; an event delivered twice, or `invoice.payment_failed`
 * arriving after `invoice.paid`, never downgrades a paid row). A calendar-month
 * draft the billing-cycle job already wrote for exactly this period is ATTACHED
 * (gets the Stripe id) rather than duplicated. */
export async function upsertInvoiceRow(
  sql: SqlClient,
  tenantId: string,
  facts: InvoiceFacts,
  status: InvoiceRowStatus,
): Promise<void> {
  const totalCents = status === "paid" ? facts.amountPaidCents : facts.amountDueCents;

  const attached = await sql<{ id: string }>`
    update public.billing_invoices
    set stripe_invoice_id = ${facts.invoiceId}, status = ${status},
        total_cents = ${totalCents}, discount_cents = ${facts.discountCents}
    where tenant_id = ${tenantId}
      and period_start = ${facts.periodStart}::date and period_end = ${facts.periodEnd}::date
      and stripe_invoice_id is null and status = 'draft'
    returning id
  `;
  if (attached.length > 0) return;

  // A local calendar-month draft that only OVERLAPS this Stripe invoice's
  // service period (subscription-anchored, e.g. 29 Sep - 29 Oct) describes the
  // same money: supersede it (void) so revenue is never counted twice.
  if (facts.periodEnd > facts.periodStart) {
    await sql`
      update public.billing_invoices set status = 'void'
      where tenant_id = ${tenantId} and stripe_invoice_id is null and status = 'draft'
        and period_start < ${facts.periodEnd}::date and period_end > ${facts.periodStart}::date
    `;
  }

  await sql`
    insert into public.billing_invoices (
      tenant_id, period_start, period_end, stripe_invoice_id, base_fee_cents,
      included_minutes, overage_minutes, overage_cents, discount_cents, total_cents, status
    ) values (
      ${tenantId}, ${facts.periodStart}::date, ${facts.periodEnd}::date, ${facts.invoiceId},
      ${facts.subtotalCents}, 0, 0, 0, ${facts.discountCents}, ${totalCents}, ${status}
    )
    on conflict (stripe_invoice_id) do update set
      status = case
        when public.billing_invoices.status = 'paid' and excluded.status <> 'paid'
          then public.billing_invoices.status
        else excluded.status
      end,
      total_cents = case
        when public.billing_invoices.status = 'paid' and excluded.status <> 'paid'
          then public.billing_invoices.total_cents
        else excluded.total_cents
      end,
      discount_cents = excluded.discount_cents,
      base_fee_cents = excluded.base_fee_cents
  `;
}

// ---------------------------------------------------------------------------
// Charges -> payment_processing_events
// ---------------------------------------------------------------------------

export interface BalanceTransactionFee {
  feeCents: number;
  netCents: number;
  currency: string | null;
}

export interface ChargeDeps {
  /** `GET /v1/balance_transactions/{id}` (`retrieveBalanceTransaction`); null
   * when Stripe is not configured or the read failed. */
  fetchBalanceTransaction?: (id: string) => Promise<BalanceTransactionFee | null>;
}

/** Fee/net for a charge: from an expanded `balance_transaction` object if the
 * payload has one, else fetched by id. */
async function chargeFee(charge: Rec, deps: ChargeDeps): Promise<BalanceTransactionFee | null> {
  const bt = charge["balance_transaction"];
  const expanded = rec(bt);
  if (expanded) {
    const fee = cents(expanded["fee"]);
    const net = cents(expanded["net"]);
    if (fee !== null && net !== null) {
      return { feeCents: fee, netCents: net, currency: str(expanded["currency"]) };
    }
  }
  const id = str(bt) ?? str(expanded?.["id"]);
  if (!id || !deps.fetchBalanceTransaction) return null;
  return deps.fetchBalanceTransaction(id);
}

export type ChargeOutcome = "recorded" | "ignored" | "deferred_tenant" | "deferred_fee";

/** Records a succeeded charge's REAL processing fee. Tenant is resolved by
 * `stripe_customer_id`; if the tenant is not linked yet (charge.succeeded beat
 * checkout.session.completed/invoice.paid) or the fee cannot be fetched, the
 * caller defers the event instead of writing a 0-fee placeholder. */
export async function recordCharge(
  sql: SqlClient,
  logger: Logger,
  charge: Rec,
  deps: ChargeDeps,
): Promise<ChargeOutcome> {
  const chargeId = str(charge["id"]);
  const customerId = str(charge["customer"]);
  // Guest charges (phone-payment Checkout, no Customer) are not tenant
  // billing; failed/pending charges have no settled fee.
  if (!chargeId || !customerId) return "ignored";
  if (charge["status"] !== undefined && charge["status"] !== "succeeded") return "ignored";

  const tenantRows = await sql<{ id: string }>`
    select id from public.tenants where stripe_customer_id = ${customerId} limit 1
  `;
  const tenantId = tenantRows[0]?.id;
  if (!tenantId) return "deferred_tenant";

  const fee = await chargeFee(charge, deps);
  if (!fee) return "deferred_fee";
  if (fee.currency && fee.currency !== "usd") {
    logger.warn("stripe_fee_non_usd", { charge_id: chargeId, currency: fee.currency });
  }

  const btId =
    str(charge["balance_transaction"]) ?? str(rec(charge["balance_transaction"])?.["id"]);
  const method =
    rec(charge["payment_method_details"])?.["type"] === "us_bank_account" ? "ach" : "card";
  const created = typeof charge["created"] === "number" ? (charge["created"] as number) : null;
  const occurredAt = created ? new Date(created * 1000).toISOString() : new Date().toISOString();

  await sql`
    insert into public.payment_processing_events (
      tenant_id, stripe_charge_id, stripe_balance_transaction_id, method, fee_cents, net_cents, occurred_at
    ) values (
      ${tenantId}, ${chargeId}, ${btId}, ${method}, ${fee.feeCents}, ${fee.netCents}, ${occurredAt}::timestamptz
    )
    on conflict (stripe_charge_id) do update set
      fee_cents = excluded.fee_cents, net_cents = excluded.net_cents,
      stripe_balance_transaction_id = coalesce(excluded.stripe_balance_transaction_id, public.payment_processing_events.stripe_balance_transaction_id)
  `;
  return "recorded";
}

/** Replays `charge.succeeded` events that were deferred for this customer
 * (called right after a tenant is linked to a Stripe customer). Never throws:
 * a replay failure leaves the event deferred for the next trigger. */
export async function replayDeferredCharges(
  sql: SqlClient,
  logger: Logger,
  deps: ChargeDeps,
  customerId: string,
): Promise<number> {
  let recorded = 0;
  try {
    const rows = await sql<{ id: string; payload: unknown }>`
      select id, payload from public.webhook_events
      where source = 'stripe' and event_type = 'charge.succeeded'
        and processing_error like 'deferred:%'
        and payload -> 'data' -> 'object' ->> 'customer' = ${customerId}
      order by created_at asc
      limit 50
    `;
    for (const row of rows) {
      const payload =
        typeof row.payload === "string" ? (JSON.parse(row.payload) as unknown) : row.payload;
      const charge = rec(rec(rec(payload)?.["data"])?.["object"]);
      if (!charge) continue;
      const outcome = await recordCharge(sql, logger, charge, deps);
      if (outcome === "recorded" || outcome === "ignored") {
        await sql`update public.webhook_events set processing_error = null where id = ${row.id}`;
        recorded += outcome === "recorded" ? 1 : 0;
      }
    }
  } catch (err) {
    logger.error("stripe_deferred_replay_failed", { customer_id: customerId, error: String(err) });
  }
  return recorded;
}
