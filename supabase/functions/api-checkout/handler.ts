import type { OneTimeCheckoutLineItem, StripeFetch } from "../_shared/providers/stripe.ts";
import { createSubscriptionCheckoutSession } from "../_shared/providers/stripe.ts";
import { CheckoutRequestSchema } from "../_shared/schemas/checkout.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";

/**
 * `/api-checkout` (API_AND_FLOWS.md A.3 "Checkout Session (subscription
 * creation at signup)", Flow 2 step 1): creates the vertical-priced
 * subscription Checkout Session — base-fee licensed price (quantity 1) plus
 * the metered-minutes price backed by the platform Billing Meter
 * (`scripts/setup-stripe.ts` creates both, once, and stores their Stripe
 * Price ids on `platform_settings.price_card_<vertical>`).
 *
 * Coordination note (docs/BUILD_NOTES.md T4 entry): API_AND_FLOWS.md Flow 2
 * describes the `tenants` row being created by the provisioning saga AFTER
 * `checkout.session.completed` (step 3), but T3's already-built
 * `/webhooks-stripe` handler and `/api-provision`'s "Tenant finalize" step
 * both read/update an EXISTING `tenants` row keyed by
 * `metadata.tenant_id` — i.e. they assume the row already exists by the
 * time checkout completes. Rather than rewire that already-tested code,
 * this function is the one that creates the `tenants` row (`status:
 * 'trialing'`) and the owner `memberships` row BEFORE creating the Checkout
 * Session, then passes `tenant_id` in Stripe metadata — reconciling the
 * flow doc's intent (a real row exists to provision) with the concrete
 * shape T3 already built against.
 */
export interface CheckoutDeps {
  stripeFetch: StripeFetch;
  stripeSecretKey: string;
  successUrl: string;
  cancelUrl: string;
  /** Injected for deterministic tests; production passes a real random
   * generator (e.g. `() => crypto.randomUUID().slice(0, 8)`). */
  randomSuffix: () => string;
  logger: Logger;
}

export type CheckoutResult =
  | { ok: true; tenant_id: string; checkout_url: string }
  | { ok: false; status: number; error: string };

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

interface PriceCardRow {
  base_cents: number;
  included_minutes: number;
  overage_cents: number;
  stripe_base_price_id?: string;
  stripe_meter_price_id?: string;
}

/**
 * `platform_settings.fees_<vertical>` (GAP_REGISTER Cluster G item 5).
 * CONTRACT NOTE (docs/audit/FIX_REQUESTS.md, Cluster H entry): the admin
 * "Fees" settings tab (`apps/web/src/app/api/admin/admin-platform-settings/
 * fees/route.ts`) is already built and reads/writes exactly this key +
 * shape — a SEPARATE `fees_<vertical>` row, not nested inside
 * `price_card_<vertical>` — with an explicit `*_enabled` gate per fee (an
 * amount can be configured ahead of time without going live). This
 * function must read the SAME key/shape or the two features never connect.
 */
interface PlatformFeesRow {
  setup_fee_enabled?: boolean;
  setup_fee_cents?: number;
  white_glove_enabled?: boolean;
  white_glove_fee_cents?: number;
}

export async function handleCheckout(
  sql: SqlClient,
  userId: string,
  rawBody: unknown,
  deps: CheckoutDeps,
): Promise<CheckoutResult> {
  const parsed = CheckoutRequestSchema.safeParse(rawBody);
  if (!parsed.success) return { ok: false, status: 422, error: "invalid_request" };
  const { vertical, business_name, email, timezone, white_glove } = parsed.data;

  const priceCardRows = await sql<{ value: PriceCardRow }>`
    select value from public.platform_settings where key = ${`price_card_${vertical}`}
  `;
  const priceCard = priceCardRows[0]?.value;
  if (!priceCard?.stripe_base_price_id || !priceCard.stripe_meter_price_id) {
    deps.logger.error("api_checkout_stripe_not_configured", { vertical });
    return { ok: false, status: 500, error: "stripe_not_configured" };
  }

  const feesRows = await sql<{ value: PlatformFeesRow }>`
    select value from public.platform_settings where key = ${`fees_${vertical}`}
  `;
  const fees = feesRows[0]?.value;

  // Idempotent re-submit: reuse an existing not-yet-paid trialing tenant
  // for this owner rather than creating a second one (e.g. the tenant hit
  // "back" on Stripe Checkout and retried signup).
  const existing = await sql<{ id: string }>`
    select t.id from public.tenants t
    join public.memberships m on m.tenant_id = t.id
    where m.user_id = ${userId} and m.role = 'owner'
      and t.status = 'trialing' and t.stripe_subscription_id is null
      and t.deleted_at is null
    order by t.created_at desc
    limit 1
  `;

  let tenantId = existing[0]?.id;
  if (!tenantId) {
    const slug = `${slugify(business_name)}-${deps.randomSuffix()}`;
    const inserted = await sql<{ id: string }>`
      insert into public.tenants (name, slug, vertical, timezone, status)
      values (${business_name}, ${slug}, ${vertical}, ${timezone ?? "America/New_York"}, 'trialing')
      returning id
    `;
    const row = inserted[0];
    if (!row) return { ok: false, status: 500, error: "tenant_create_failed" };
    tenantId = row.id;
    await sql`
      insert into public.memberships (tenant_id, user_id, role, accepted_at)
      values (${tenantId}, ${userId}, 'owner', now())
      on conflict (tenant_id, user_id) do nothing
    `;
  }

  const oneTimeLineItems: OneTimeCheckoutLineItem[] = [];
  if (fees?.setup_fee_enabled && (fees.setup_fee_cents ?? 0) > 0) {
    oneTimeLineItems.push({
      productName: "One-time setup fee",
      amountCents: fees.setup_fee_cents as number,
    });
  }
  if (white_glove && fees?.white_glove_enabled && (fees.white_glove_fee_cents ?? 0) > 0) {
    oneTimeLineItems.push({
      productName: "White-glove onboarding",
      amountCents: fees.white_glove_fee_cents as number,
    });
  }

  const session = await createSubscriptionCheckoutSession(deps.stripeFetch, deps.stripeSecretKey, {
    customerEmail: email,
    basePriceId: priceCard.stripe_base_price_id,
    meteredPriceId: priceCard.stripe_meter_price_id,
    successUrl: deps.successUrl,
    cancelUrl: deps.cancelUrl,
    metadata: { tenant_id: tenantId, vertical, user_id: userId },
    ...(oneTimeLineItems.length > 0 ? { oneTimeLineItems } : {}),
  });

  const body = session.body as { id?: string; url?: string };
  if (!session.ok || !body.url) {
    deps.logger.error("api_checkout_session_create_failed", {
      tenant_id: tenantId,
      status: session.status,
    });
    return { ok: false, status: 502, error: "checkout_session_create_failed" };
  }

  return { ok: true, tenant_id: tenantId, checkout_url: body.url };
}
