import type { StripeEvent } from "../_shared/schemas/stripe-event.ts";

/**
 * Real-shaped Stripe event payloads for the webhook ordering tests
 * (SIGNUP-BILL-FIX). Shapes follow the current Stripe API reference for API
 * version 2025-08-27.basil (docs.stripe.com/api/invoices/object,
 * /invoices/line_item, /charges/object, /events/types — fetched 2026-09-29):
 * an invoice's subscription is `parent.subscription_details.subscription` with
 * the subscription metadata snapshot at `parent.subscription_details.metadata`;
 * a Charge has no invoice/subscription fields at all; amounts are integer
 * cents; timestamps are unix seconds.
 */

export const TENANT_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
export const CUSTOMER_ID = "cus_TestSignup1";
export const SUBSCRIPTION_ID = "sub_1TestSignup1";
export const INVOICE_ID = "in_1TestSignup1";
export const CHARGE_ID = "ch_3TestSignup1";
export const BALANCE_TXN_ID = "txn_3TestSignup1";

/** 2026-09-29T15:04:05Z */
export const T0 = 1_790_000_000;
/** 2026-10-29T15:04:05Z (one calendar month later) */
export const T1 = T0 + 30 * 86_400;

export function isoDay(unix: number): string {
  return new Date(unix * 1000).toISOString().slice(0, 10);
}

export function checkoutSessionCompleted(
  overrides: { id?: string; tenantId?: string; customer?: string; subscription?: string } = {},
): StripeEvent {
  const tenantId = overrides.tenantId ?? TENANT_ID;
  return {
    id: overrides.id ?? "evt_1CheckoutCompleted",
    type: "checkout.session.completed",
    livemode: false,
    data: {
      object: {
        id: "cs_test_a1B2c3",
        object: "checkout.session",
        mode: "subscription",
        status: "complete",
        payment_status: "paid",
        customer: overrides.customer ?? CUSTOMER_ID,
        subscription: overrides.subscription ?? SUBSCRIPTION_ID,
        invoice: INVOICE_ID,
        payment_intent: null,
        amount_total: 29_900,
        currency: "usd",
        customer_details: { email: "owner@example.com" },
        metadata: { tenant_id: tenantId, vertical: "auto", user_id: "user_1" },
      },
    },
  };
}

export function invoiceObject(
  overrides: {
    id?: string;
    status?: "paid" | "open";
    amountPaid?: number;
    amountDue?: number;
    total?: number;
    customer?: string;
    subscription?: string;
    tenantId?: string | null;
    periodStart?: number;
    periodEnd?: number;
    withSetupFee?: boolean;
    discountCents?: number;
  } = {},
): Record<string, unknown> {
  const periodStart = overrides.periodStart ?? T0;
  const periodEnd = overrides.periodEnd ?? T1;
  const paid = (overrides.status ?? "paid") === "paid";
  const total = overrides.total ?? 29_900;
  const tenantId = overrides.tenantId === undefined ? TENANT_ID : overrides.tenantId;
  const lines: Record<string, unknown>[] = [];
  if (overrides.withSetupFee) {
    // One-time line item: zero-length period (creation time), listed first.
    lines.push({
      id: "il_setup",
      object: "line_item",
      amount: 10_000,
      currency: "usd",
      description: "One-time setup fee",
      metadata: {},
      parent: { type: "invoice_item_details", invoice_item_details: { invoice_item: "ii_1", subscription: null } },
      period: { start: periodStart, end: periodStart },
    });
  }
  lines.push({
    id: "il_base",
    object: "line_item",
    amount: 29_900,
    currency: "usd",
    description: "1 x Heyloo Auto Repair (at $299.00 / month)",
    metadata: tenantId ? { tenant_id: tenantId } : {},
    parent: {
      type: "subscription_item_details",
      subscription_item_details: { subscription: overrides.subscription ?? SUBSCRIPTION_ID, proration: false },
    },
    period: { start: periodStart, end: periodEnd },
    pricing: { type: "price_details", price_details: { price: "price_base", product: "prod_base" } },
    quantity: 1,
  });
  return {
    id: overrides.id ?? INVOICE_ID,
    object: "invoice",
    account_name: "Heyloo",
    amount_due: overrides.amountDue ?? (paid ? total : total),
    amount_paid: overrides.amountPaid ?? (paid ? total : 0),
    amount_remaining: paid ? 0 : total,
    billing_reason: "subscription_create",
    collection_method: "charge_automatically",
    currency: "usd",
    customer: overrides.customer ?? CUSTOMER_ID,
    customer_email: "owner@example.com",
    lines: { object: "list", data: lines, has_more: false, total_count: lines.length, url: "/v1/invoices/x/lines" },
    livemode: false,
    metadata: {},
    parent: {
      type: "subscription_details",
      quote_details: null,
      subscription_details: {
        subscription: overrides.subscription ?? SUBSCRIPTION_ID,
        metadata: tenantId ? { tenant_id: tenantId, vertical: "auto", user_id: "user_1" } : {},
      },
    },
    period_start: periodStart,
    period_end: periodEnd,
    status: paid ? "paid" : "open",
    subtotal: total + (overrides.discountCents ?? 0),
    total,
    total_discount_amounts:
      overrides.discountCents ? [{ amount: overrides.discountCents, discount: "di_1" }] : [],
  };
}

export function invoicePaid(
  overrides: Parameters<typeof invoiceObject>[0] & { eventId?: string } = {},
): StripeEvent {
  return {
    id: overrides.eventId ?? "evt_1InvoicePaid",
    type: "invoice.paid",
    livemode: false,
    data: { object: invoiceObject({ ...overrides, status: "paid" }) },
  };
}

export function invoicePaymentFailed(
  overrides: Parameters<typeof invoiceObject>[0] & { eventId?: string } = {},
): StripeEvent {
  return {
    id: overrides.eventId ?? "evt_1InvoiceFailed",
    type: "invoice.payment_failed",
    livemode: false,
    data: { object: invoiceObject({ ...overrides, status: "open" }) },
  };
}

export function chargeSucceeded(
  overrides: { id?: string; eventId?: string; customer?: string | null; balanceTransaction?: string } = {},
): StripeEvent {
  return {
    id: overrides.eventId ?? "evt_3ChargeSucceeded",
    type: "charge.succeeded",
    livemode: false,
    data: {
      object: {
        id: overrides.id ?? CHARGE_ID,
        object: "charge",
        amount: 29_900,
        amount_captured: 29_900,
        balance_transaction: overrides.balanceTransaction ?? BALANCE_TXN_ID,
        billing_details: { email: "owner@example.com" },
        created: T0,
        currency: "usd",
        customer: overrides.customer === undefined ? CUSTOMER_ID : overrides.customer,
        metadata: {},
        paid: true,
        payment_intent: "pi_3TestSignup1",
        payment_method_details: { type: "card", card: { brand: "visa", last4: "4242" } },
        status: "succeeded",
      },
    },
  };
}

/** What `GET /v1/balance_transactions/txn_...` returns for the charge above:
 * 2.9% + 30c of $299.00 = 897c fee (integer cents), net = amount - fee. */
export const BALANCE_TXN = { feeCents: 897, netCents: 29_900 - 897, currency: "usd" };
