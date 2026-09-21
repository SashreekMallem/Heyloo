import { CheckoutRequestSchema } from "../_shared/schemas/checkout.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";

/**
 * `/api-admin-complete-test-checkout` (SIGNUP-1, docs/BUILD_NOTES.md
 * SIGNUP-1 entry): internal-only, `x-internal-secret`-guarded stand-in for
 * the part of `/api-checkout` (tenant + owner membership creation, "Flow 2
 * step 1") that a real signup can never reach on THIS platform because
 * Stripe is not configured (`platform_settings.price_card_<vertical>` has
 * no `stripe_base_price_id`/`stripe_meter_price_id` set, and there is no
 * `STRIPE_SECRET_KEY` secret at all — `api-checkout` correctly fails
 * CLOSED with `stripe_not_configured` before creating anything, per
 * CLAUDE.md Rule 2's "fail closed" webhook/payment posture).
 *
 * This function does the EXACT SAME tenant-creation shape `api-checkout`'s
 * `handleCheckout` uses (same slugify, same idempotent
 * "reuse an existing not-yet-paid trialing tenant for this owner" guard,
 * same owner `memberships` insert) but never calls Stripe and always sets
 * `tenants.is_test = true` — so a test tenant provisioned this way is
 * unambiguously marked, is excluded from every real-customer
 * revenue/billing query the same way `call_logs.is_test_call`/
 * `bookings.is_test` already are for other surfaces, and can never be
 * mistaken for a real paying signup. It resolves the owner `user_id` from
 * the `email` argument (an already-authenticated Supabase Auth user, e.g.
 * one that just completed a real `supabase.auth.signUp` in the browser) —
 * there is no session to read it from, since this is an internal call, not
 * a request from that user's own browser.
 *
 * NEVER used for a real (non-test) tenant: this function only ever sets
 * `is_test = true`, and the caller (a human operator, or an E2E harness)
 * is solely responsible for using it only against a throwaway signup.
 */

export interface CompleteTestCheckoutResult {
  status: number;
  body: { tenant_id: string } | { error: string };
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export interface CompleteTestCheckoutDeps {
  logger: Logger;
  /** Overrides the generated slug entirely when set — used by SIGNUP-1's
   * own live run to pin a specific, memorable slug (`signup-1-auto`) rather
   * than a random suffix, so a later task can find this exact tenant/number
   * again. Optional; every other caller omits it and gets the same
   * `${slugify(business_name)}-${randomSuffix()}` shape `api-checkout` uses. */
  randomSuffix: () => string;
}

export async function completeTestCheckout(
  sql: SqlClient,
  rawBody: unknown,
  deps: CompleteTestCheckoutDeps,
): Promise<CompleteTestCheckoutResult> {
  const parsed = CheckoutRequestSchema.pick({
    vertical: true,
    business_name: true,
    email: true,
  }).safeParse(rawBody);
  if (!parsed.success) return { status: 422, body: { error: "invalid_request" } };
  const { vertical, business_name, email } = parsed.data;
  const requestedSlug =
    typeof (rawBody as { slug?: unknown })?.slug === "string" &&
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test((rawBody as { slug: string }).slug)
      ? (rawBody as { slug: string }).slug
      : null;

  const userRows = await sql<{ id: string }>`
    select id from auth.users where lower(email) = lower(${email}) limit 1
  `;
  const userId = userRows[0]?.id;
  if (!userId) {
    deps.logger.error("complete_test_checkout_user_not_found", { email });
    return { status: 404, body: { error: "user_not_found" } };
  }

  // Idempotent re-run: reuse an existing not-yet-provisioned test tenant for
  // this owner (same guard `api-checkout` uses for the real flow) rather
  // than creating a second one.
  const existing = await sql<{ id: string }>`
    select t.id from public.tenants t
    join public.memberships m on m.tenant_id = t.id
    where m.user_id = ${userId} and m.role = 'owner'
      and t.is_test and t.status = 'trialing' and t.deleted_at is null
    order by t.created_at desc
    limit 1
  `;
  if (existing[0]) {
    return { status: 200, body: { tenant_id: existing[0].id } };
  }

  const slug = requestedSlug ?? `${slugify(business_name)}-${deps.randomSuffix()}`;
  const inserted = await sql<{ id: string }>`
    insert into public.tenants (name, slug, vertical, timezone, status, is_test)
    values (${business_name}, ${slug}, ${vertical}, 'America/New_York', 'trialing', true)
    returning id
  `;
  const row = inserted[0];
  if (!row) return { status: 500, body: { error: "tenant_create_failed" } };
  const tenantId = row.id;
  await sql`
    insert into public.memberships (tenant_id, user_id, role, accepted_at)
    values (${tenantId}, ${userId}, 'owner', now())
    on conflict (tenant_id, user_id) do nothing
  `;

  deps.logger.info("complete_test_checkout_tenant_created", { tenant_id: tenantId, vertical });
  return { status: 200, body: { tenant_id: tenantId } };
}
