/**
 * Minimal Stripe REST client via plain `fetch` (no SDK — see
 * providers/retell.ts for the same rationale, and stripe-signature.ts for
 * why webhook verification is hand-rolled rather than SDK-based). Stripe's
 * REST API accepts `application/x-www-form-urlencoded` with PHP-style
 * bracket nesting for nested params/arrays — `flattenStripeParams` below
 * implements that encoding. VERIFY (docs/VERIFY.md): confirm
 * `STRIPE_API_VERSION` pin and the exact Checkout Session / balance
 * transaction field names against Stripe's live API reference
 * (egress-blocked in this build) before go-live.
 */

const STRIPE_BASE_URL = "https://api.stripe.com/v1";
const STRIPE_API_VERSION = "2025-08-27.basil"; // VERIFY.md: confirm current pinned version at build time.

export type StripeFetch = (input: string, init?: RequestInit) => Promise<Response>;

/** Flattens a nested object/array into Stripe's bracketed form-encoding,
 * e.g. `{line_items: [{price_data: {unit_amount: 500}}]}` ->
 * `line_items[0][price_data][unit_amount]=500`. */
export function flattenStripeParams(
  value: unknown,
  prefix = "",
  out: Record<string, string> = {},
): Record<string, string> {
  if (value === undefined || value === null) return out;
  if (Array.isArray(value)) {
    for (const [i, item] of value.entries()) {
      flattenStripeParams(item, `${prefix}[${i}]`, out);
    }
    return out;
  }
  if (typeof value === "object") {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      flattenStripeParams(v, prefix ? `${prefix}[${key}]` : key, out);
    }
    return out;
  }
  out[prefix] = String(value);
  return out;
}

async function stripeRequest(
  fetchImpl: StripeFetch,
  secretKey: string,
  method: "GET" | "POST",
  path: string,
  params?: Record<string, unknown>,
  options?: { idempotencyKey?: string },
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const query =
    method === "GET" && params ? `?${new URLSearchParams(flattenStripeParams(params))}` : "";
  const res = await fetchImpl(`${STRIPE_BASE_URL}${path}${query}`, {
    method,
    headers: {
      authorization: `Bearer ${secretKey}`,
      "content-type": "application/x-www-form-urlencoded",
      "Stripe-Version": STRIPE_API_VERSION,
      // docs.stripe.com/api/idempotent_requests (fetched 2026-09-30): any POST accepts
      // `Idempotency-Key` (<= 255 chars); keys are pruned after >= 24 h.
      ...(options?.idempotencyKey && method === "POST"
        ? { "Idempotency-Key": options.idempotencyKey }
        : {}),
    },
    ...(method === "POST" && params
      ? { body: new URLSearchParams(flattenStripeParams(params)).toString() }
      : {}),
  });
  const body = await res.json().catch(() => undefined);
  return { ok: res.ok, status: res.status, body };
}

/**
 * `mode=subscription` Checkout Session (API_AND_FLOWS.md A.3 "Checkout
 * Session (subscription creation at signup)") — two line items: the
 * vertical's licensed base-fee price (quantity 1) plus the metered-minutes
 * price (no `quantity` field for a metered price; Stripe computes it from
 * reported meter events). `metadata.tenant_id` is what `/webhooks-stripe`'s
 * `checkout.session.completed` handler reads to kick off provisioning.
 */
/**
 * One-time (non-recurring) line item added alongside the recurring
 * subscription items below — setup fee / white-glove onboarding
 * (GAP_REGISTER Cluster G item 5). Confirmed live against
 * docs.stripe.com/api/checkout/sessions/create#create_checkout_session-line_items
 * (Rule 1, fetched 2026-09-10): a `subscription`-mode Checkout Session
 * allows up to 20 one-time-Price line items alongside its recurring ones,
 * billed "on the initial invoice only" — exactly the setup-fee/white-glove
 * semantics needed (a signup-time-only charge, never repeated on renewal).
 * Uses `price_data` (an ad-hoc inline Price, `recurring` omitted) rather
 * than a pre-created Stripe Price object, since these amounts are
 * admin-set per-vertical config (`platform_settings.price_card_<vertical>`)
 * rather than a small fixed catalog worth provisioning through
 * `scripts/setup-stripe.ts`.
 */
export interface OneTimeCheckoutLineItem {
  productName: string;
  amountCents: number;
}

export async function createSubscriptionCheckoutSession(
  fetchImpl: StripeFetch,
  secretKey: string,
  params: {
    customerId?: string;
    customerEmail?: string;
    basePriceId: string;
    meteredPriceId: string;
    successUrl: string;
    cancelUrl: string;
    metadata: Record<string, string>;
    /** Setup fee / white-glove — omitted or empty when neither applies to
     * this signup (the common case: no extra charge beyond the recurring
     * subscription). */
    oneTimeLineItems?: OneTimeCheckoutLineItem[];
  },
) {
  const oneTimeItems = (params.oneTimeLineItems ?? []).map((item) => ({
    price_data: {
      currency: "usd",
      unit_amount: item.amountCents,
      product_data: { name: item.productName },
    },
    quantity: 1,
  }));

  return stripeRequest(fetchImpl, secretKey, "POST", "/checkout/sessions", {
    mode: "subscription",
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    ...(params.customerId ? { customer: params.customerId } : {}),
    ...(!params.customerId && params.customerEmail ? { customer_email: params.customerEmail } : {}),
    line_items: [
      { price: params.basePriceId, quantity: 1 },
      { price: params.meteredPriceId },
      ...oneTimeItems,
    ],
    subscription_data: { metadata: params.metadata },
    metadata: params.metadata,
  });
}

/**
 * POST /v1/billing/meters — one-time, platform-level setup (SYSTEM_DESIGN
 * §3, `scripts/setup-stripe.ts`), not called per-tenant. `customer_mapping`/
 * `value_settings` default to the documented shapes (`by_id` /
 * `stripe_customer_id` / `value`) per current Stripe Billing Meters
 * guidance (VERIFY.md — confirmed via indexed search, docs.stripe.com
 * itself egress-blocked in this build).
 */
export async function createMeter(
  fetchImpl: StripeFetch,
  secretKey: string,
  params: { displayName: string; eventName: string },
) {
  return stripeRequest(fetchImpl, secretKey, "POST", "/billing/meters", {
    display_name: params.displayName,
    event_name: params.eventName,
    // Required by POST /v1/billing/meters (docs.stripe.com/api/billing/meter/create, verified 2026-09-29).
    default_aggregation: { formula: "sum" },
    customer_mapping: { type: "by_id", event_payload_key: "stripe_customer_id" },
    value_settings: { event_payload_key: "value" },
  });
}

export async function listMeters(fetchImpl: StripeFetch, secretKey: string) {
  return stripeRequest(fetchImpl, secretKey, "GET", "/billing/meters", { limit: 100 });
}

export async function createProduct(
  fetchImpl: StripeFetch,
  secretKey: string,
  params: { name: string },
) {
  return stripeRequest(fetchImpl, secretKey, "POST", "/products", { name: params.name });
}

/** Licensed (flat monthly base-fee) recurring Price. */
export async function createLicensedPrice(
  fetchImpl: StripeFetch,
  secretKey: string,
  params: { productId: string; unitAmountCents: number; currency: string; nickname: string },
) {
  return stripeRequest(fetchImpl, secretKey, "POST", "/prices", {
    product: params.productId,
    unit_amount: params.unitAmountCents,
    currency: params.currency,
    recurring: { interval: "month" },
    nickname: params.nickname,
  });
}

/** Metered recurring Price backed by a Billing Meter (every metered price
 * requires a backing meter per current Stripe guidance) — `unitAmountCents`
 * here is the OVERAGE per-minute rate; the included-minutes allowance is
 * enforced on our side (job-billing-cycle only reports `billable_minutes`
 * minus `included_minutes` — VERIFY.md: confirm whether Stripe's own tiered
 * pricing could instead express the free allowance natively). */
export async function createMeteredPrice(
  fetchImpl: StripeFetch,
  secretKey: string,
  params: {
    productId: string;
    meterId: string;
    unitAmountCents: number;
    currency: string;
    nickname: string;
  },
) {
  return stripeRequest(fetchImpl, secretKey, "POST", "/prices", {
    product: params.productId,
    unit_amount: params.unitAmountCents,
    currency: params.currency,
    billing_scheme: "per_unit",
    recurring: { interval: "month", meter: params.meterId, usage_type: "metered" },
    nickname: params.nickname,
  });
}

export async function createCheckoutSession(
  fetchImpl: StripeFetch,
  secretKey: string,
  params: {
    mode: "payment";
    successUrl: string;
    cancelUrl: string;
    amountCents: number;
    currency: string;
    productName: string;
    metadata: Record<string, string>;
  },
) {
  return stripeRequest(fetchImpl, secretKey, "POST", "/checkout/sessions", {
    mode: params.mode,
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: params.currency,
          unit_amount: params.amountCents,
          product_data: { name: params.productName },
        },
      },
    ],
    metadata: params.metadata,
  });
}

export async function retrieveBalanceTransaction(
  fetchImpl: StripeFetch,
  secretKey: string,
  balanceTransactionId: string,
) {
  return stripeRequest(
    fetchImpl,
    secretKey,
    "GET",
    `/balance_transactions/${encodeURIComponent(balanceTransactionId)}`,
  );
}

/**
 * Meter event `payload[value]` must be a plain decimal with at most 12 decimal
 * places and at most 15 digits (BILL-1: live sums such as 300.000000000000005
 * or 3.566666666666667 were rejected with HTTP 400, so overage was never
 * reported). Usage is reported to 6 decimals (a microminute), far below a cent
 * at any overage rate; trailing zeros are dropped and exponent form is never
 * produced.
 */
export const METER_VALUE_DECIMALS = 6;
const METER_VALUE_MAX_DIGITS = 15;

export function formatMeterValue(value: number | string): string {
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n) || n < 0) {
    throw new RangeError("meter value must be a finite, non-negative number");
  }
  const fixed = n.toFixed(METER_VALUE_DECIMALS); // exponent form only from 1e21 up
  const [intPart = "0", frac = ""] = fixed.split(".");
  if (intPart.length > METER_VALUE_MAX_DIGITS) {
    throw new RangeError("meter value has more than 15 digits");
  }
  const fracDigits = frac.slice(0, METER_VALUE_MAX_DIGITS - intPart.length).replace(/0+$/, "");
  return fracDigits ? `${intPart}.${fracDigits}` : intPart;
}

/**
 * POST /v1/billing/meter_events (docs.stripe.com/api/billing/meter-event/create,
 * fetched 2026-09-30). `identifier` is de-duplicated by Stripe for a rolling
 * period of at least 24 h. `timestamp` (Unix seconds) must be within the past
 * 35 days or up to 5 minutes ahead and defaults to now, so a month's usage
 * reported on the 1st would otherwise be stamped in the NEXT subscription
 * period (BILL-12): callers pass a time inside the period being reported.
 */
export async function createBillingMeterEvent(
  fetchImpl: StripeFetch,
  secretKey: string,
  params: {
    eventName: string;
    stripeCustomerId: string;
    value: number | string;
    identifier: string;
    timestamp?: number;
  },
) {
  return stripeRequest(fetchImpl, secretKey, "POST", "/billing/meter_events", {
    event_name: params.eventName,
    identifier: params.identifier,
    payload: {
      stripe_customer_id: params.stripeCustomerId,
      value: formatMeterValue(params.value),
    },
    ...(params.timestamp === undefined ? {} : { timestamp: Math.floor(params.timestamp) }),
  });
}

/**
 * POST /v1/invoiceitems (docs.stripe.com/api/invoiceitems/create, fetched
 * 2026-09-30): with no `invoice`/`subscription` the item joins the next invoice
 * created for the customer, which is how a period's text-reply overage (BILL-4)
 * rides on the subscription's next renewal. `idempotencyKey` guards a retry
 * inside Stripe's 24 h window; the caller also records the created item id
 * locally so a later retry never creates a second one.
 */
export async function createInvoiceItem(
  fetchImpl: StripeFetch,
  secretKey: string,
  params: {
    customerId: string;
    amountCents: number;
    currency: string;
    description: string;
    periodStart: number;
    periodEnd: number;
    metadata?: Record<string, string>;
    idempotencyKey: string;
  },
) {
  return stripeRequest(
    fetchImpl,
    secretKey,
    "POST",
    "/invoiceitems",
    {
      customer: params.customerId,
      amount: params.amountCents,
      currency: params.currency,
      description: params.description,
      period: { start: Math.floor(params.periodStart), end: Math.floor(params.periodEnd) },
      ...(params.metadata ? { metadata: params.metadata } : {}),
    },
    { idempotencyKey: params.idempotencyKey },
  );
}

/**
 * POST /v1/billing_portal/sessions (docs.stripe.com/api/customer_portal/sessions/create,
 * fetched 2026-09-30): `customer` + `return_url` -> `{ url }`. Uses the account's
 * default portal configuration unless `configurationId` is given; a portal
 * configuration must be saved in the Stripe Dashboard first (docs/VERIFY.md).
 */
export async function createBillingPortalSession(
  fetchImpl: StripeFetch,
  secretKey: string,
  params: { customerId: string; returnUrl: string; configurationId?: string },
) {
  return stripeRequest(fetchImpl, secretKey, "POST", "/billing_portal/sessions", {
    customer: params.customerId,
    return_url: params.returnUrl,
    ...(params.configurationId ? { configuration: params.configurationId } : {}),
  });
}
