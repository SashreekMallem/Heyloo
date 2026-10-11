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

import { z } from "zod";

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
  options?: { idempotencyKey?: string; timeoutMs?: number },
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
    // Opt-in: a background caller that must not hang on Stripe (TRIAL-1 cap).
    ...(options?.timeoutMs ? { signal: AbortSignal.timeout(options.timeoutMs) } : {}),
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
/**
 * TRIAL-1 (docs.stripe.com/api/checkout/sessions/create and
 * /billing/subscriptions/trials/free-trials, fetched 2026-10-11):
 * `subscription_data.trial_period_days` is an integer "at least 1"; a trial
 * "must be 730 days (2 years) or less". `payment_method_collection` defaults
 * to `always`; only `if_required` skips the card when nothing is due today.
 * One-time line items alongside a trial are still charged at signup.
 */
const STRIPE_MAX_TRIAL_PERIOD_DAYS = 730;

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
    /** TRIAL-1: free-trial length in whole days (1-730). Omitted = no trial. */
    trialPeriodDays?: number;
  },
) {
  const trialDays = params.trialPeriodDays;
  if (
    trialDays !== undefined &&
    (!Number.isInteger(trialDays) || trialDays < 1 || trialDays > STRIPE_MAX_TRIAL_PERIOD_DAYS)
  ) {
    throw new RangeError("trialPeriodDays must be a whole number of days from 1 to 730");
  }
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
    subscription_data: {
      metadata: params.metadata,
      ...(trialDays !== undefined ? { trial_period_days: trialDays } : {}),
    },
    // TRIAL-1: a card is always collected, also for a trial session whose
    // amount due today is $0 (`always` is Stripe's default; stated so the
    // "card required" rule does not depend on it).
    ...(trialDays !== undefined ? { payment_method_collection: "always" } : {}),
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

/**
 * The slice of a Stripe Subscription the free-trial cap needs
 * (docs.stripe.com/api/subscriptions/object, fetched 2026-10-11): `status` is
 * one of incomplete | incomplete_expired | trialing | active | past_due |
 * canceled | unpaid | paused; `trial_end` is a nullable Unix timestamp
 * ("If the subscription has a trial, the end of that trial");
 * `cancel_at_period_end` (boolean, "will cancel at the end of the current
 * billing period", which during a trial is the trial end) and `cancel_at`
 * (nullable timestamp, "a date in the future at which the subscription will
 * automatically get canceled") say whether the owner already canceled.
 * Validated at the boundary (CLAUDE.md Rule 1): an unexpected body is a
 * failure, never a guess. `cancel_at_period_end` is required: if it is not
 * known whether a cancellation is pending, the cap must not end the trial.
 */
const SubscriptionTrialStateSchema = z.object({
  id: z.string().min(1),
  status: z.enum([
    "incomplete",
    "incomplete_expired",
    "trialing",
    "active",
    "past_due",
    "canceled",
    "unpaid",
    "paused",
  ]),
  trial_end: z.number().int().positive().nullable().optional(),
  cancel_at_period_end: z.boolean(),
  cancel_at: z.number().int().positive().nullable().optional(),
});

export interface SubscriptionTrialState {
  id: string;
  status: z.infer<typeof SubscriptionTrialStateSchema>["status"];
  /** Unix seconds, or null when the subscription has no trial. */
  trialEnd: number | null;
  cancelAtPeriodEnd: boolean;
  /** Unix seconds of a scheduled cancellation, null when none. */
  cancelAt: number | null;
}

export type SubscriptionTrialResult =
  | { ok: true; subscription: SubscriptionTrialState }
  | { ok: false; status: number; error: string };

function toTrialResult(res: {
  ok: boolean;
  status: number;
  body: unknown;
}): SubscriptionTrialResult {
  if (!res.ok) {
    const message = (res.body as { error?: { code?: unknown; type?: unknown } } | undefined)?.error;
    const code = typeof message?.code === "string" ? message.code : undefined;
    const type = typeof message?.type === "string" ? message.type : undefined;
    return { ok: false, status: res.status, error: code ?? type ?? "stripe_error" };
  }
  const parsed = SubscriptionTrialStateSchema.safeParse(res.body);
  if (!parsed.success) return { ok: false, status: res.status, error: "unexpected_response" };
  return {
    ok: true,
    subscription: {
      id: parsed.data.id,
      status: parsed.data.status,
      trialEnd: parsed.data.trial_end ?? null,
      cancelAtPeriodEnd: parsed.data.cancel_at_period_end,
      cancelAt: parsed.data.cancel_at ?? null,
    },
  };
}

/** Both trial calls run in a background task (voice-events after the webhook
 * ack, the hourly job): bounded so a hung Stripe request cannot hold it. */
const STRIPE_TRIAL_CALL_TIMEOUT_MS = 8_000;

/** A request that never got an HTTP answer (timeout, network) is a failure
 * with status 0, so the caller's failure path (alert, retry) handles it. */
async function trialRequest(
  run: () => Promise<{ ok: boolean; status: number; body: unknown }>,
): Promise<SubscriptionTrialResult> {
  try {
    return toTrialResult(await run());
  } catch (err) {
    // AbortSignal.timeout rejects with a DOMException named "TimeoutError".
    const name = (err as { name?: unknown } | null)?.name;
    const timedOut = name === "TimeoutError" || name === "AbortError";
    return { ok: false, status: 0, error: timedOut ? "timeout" : "network_error" };
  }
}

/** GET /v1/subscriptions/{id} (docs.stripe.com/api/subscriptions/retrieve). */
export async function retrieveSubscriptionTrialState(
  fetchImpl: StripeFetch,
  secretKey: string,
  subscriptionId: string,
): Promise<SubscriptionTrialResult> {
  return trialRequest(() =>
    stripeRequest(
      fetchImpl,
      secretKey,
      "GET",
      `/subscriptions/${encodeURIComponent(subscriptionId)}`,
      undefined,
      { timeoutMs: STRIPE_TRIAL_CALL_TIMEOUT_MS },
    ),
  );
}

/**
 * POST /v1/subscriptions/{id} with `trial_end=now` — "The special value `now`
 * can be provided to end the customer's trial immediately" (docs.stripe.com/
 * api/subscriptions/update and /billing/subscriptions/trials/free-trials "To
 * end a trial early ... setting the trial_end value to ... now", fetched
 * 2026-10-11). Ending a trial resets the billing cycle anchor to now and
 * charges the plan immediately. The caller must first confirm the
 * subscription is still `trialing`: on a subscription that is not, `trial_end`
 * would move its billing cycle instead.
 */
export async function endSubscriptionTrialNow(
  fetchImpl: StripeFetch,
  secretKey: string,
  subscriptionId: string,
  options: { idempotencyKey: string },
): Promise<SubscriptionTrialResult> {
  return trialRequest(() =>
    stripeRequest(
      fetchImpl,
      secretKey,
      "POST",
      `/subscriptions/${encodeURIComponent(subscriptionId)}`,
      { trial_end: "now" },
      { idempotencyKey: options.idempotencyKey, timeoutMs: STRIPE_TRIAL_CALL_TIMEOUT_MS },
    ),
  );
}
