import type { StripeFetch } from "../_shared/providers/stripe.ts";
import { createBillingPortalSession } from "../_shared/providers/stripe.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";

/**
 * `/api-billing-portal` (BILL-9): "Manage payment method" on the billing page
 * and the link in the dunning email. Returns a one-time Stripe Billing Portal
 * URL for the caller's OWN tenant: `tenant_id` comes only from the verified JWT
 * (never the body), and the caller must be an owner/admin member of that tenant
 * (a plain `member` cannot open the payment portal). The Stripe customer id is
 * read from `tenants.stripe_customer_id`, never from the request.
 *
 * Needs a Billing Portal configuration saved once in the Stripe Dashboard
 * (Settings > Billing > Customer portal); without one Stripe answers 400 and this
 * returns `portal_unavailable` (docs/VERIFY.md BILL-9).
 */
export interface BillingPortalDeps {
  stripeFetch: StripeFetch;
  stripeSecretKey: string;
  returnUrl: string;
  logger: Logger;
}

export type BillingPortalResult =
  | { ok: true; url: string }
  | { ok: false; status: number; error: string };

export async function handleBillingPortal(
  sql: SqlClient,
  userId: string,
  tenantId: string,
  deps: BillingPortalDeps,
): Promise<BillingPortalResult> {
  const rows = await sql<{ stripe_customer_id: string | null }>`
    select t.stripe_customer_id
    from public.tenants t
    join public.memberships m on m.tenant_id = t.id
    where t.id = ${tenantId} and t.deleted_at is null
      and m.user_id = ${userId} and m.role in ('owner', 'admin')
    limit 1
  `;
  const row = rows[0];
  if (!row) return { ok: false, status: 403, error: "forbidden" };
  if (!row.stripe_customer_id) return { ok: false, status: 409, error: "no_billing_account" };

  const session = await createBillingPortalSession(deps.stripeFetch, deps.stripeSecretKey, {
    customerId: row.stripe_customer_id,
    returnUrl: deps.returnUrl,
  });
  const body = session.body as { url?: string } | undefined;
  if (!session.ok || !body?.url) {
    deps.logger.error("api_billing_portal_session_failed", {
      tenant_id: tenantId,
      status: session.status,
    });
    return { ok: false, status: 502, error: "portal_unavailable" };
  }
  return { ok: true, url: body.url };
}
