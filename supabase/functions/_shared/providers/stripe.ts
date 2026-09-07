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
