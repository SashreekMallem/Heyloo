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
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const query =
    method === "GET" && params ? `?${new URLSearchParams(flattenStripeParams(params))}` : "";
  const res = await fetchImpl(`${STRIPE_BASE_URL}${path}${query}`, {
    method,
    headers: {
      authorization: `Bearer ${secretKey}`,
      "content-type": "application/x-www-form-urlencoded",
      "Stripe-Version": STRIPE_API_VERSION,
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
  },
) {
  return stripeRequest(fetchImpl, secretKey, "POST", "/checkout/sessions", {
    mode: "subscription",
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    ...(params.customerId ? { customer: params.customerId } : {}),
    ...(!params.customerId && params.customerEmail ? { customer_email: params.customerEmail } : {}),
    line_items: [{ price: params.basePriceId, quantity: 1 }, { price: params.meteredPriceId }],
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

export async function createBillingMeterEvent(
  fetchImpl: StripeFetch,
  secretKey: string,
  params: { eventName: string; stripeCustomerId: string; value: number; identifier: string },
) {
  return stripeRequest(fetchImpl, secretKey, "POST", "/billing/meter_events", {
    event_name: params.eventName,
    identifier: params.identifier,
    payload: { stripe_customer_id: params.stripeCustomerId, value: params.value },
  });
}
