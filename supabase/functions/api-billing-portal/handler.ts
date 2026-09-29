import { z } from "zod";
import type { StripeFetch } from "../_shared/providers/stripe.ts";
import { createBillingPortalSession } from "../_shared/providers/stripe.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";

/**
 * `api-billing-portal` (QA-1 F-12) — "Manage payment method" on the tenant
 * dashboard's Billing page. Returns `{ url }`: a Stripe-hosted Customer Portal
 * session for THIS tenant's own Stripe customer.
 *
 * Runs as service role (bypasses RLS), so it independently verifies what the
 * caller may do (CLAUDE.md Rule 2): the tenant id and caller id come only from
 * the verified JWT (index.ts), and only a tenant `owner` may open the billing
 * portal — a payment-method change is an owner-level action, same posture as
 * `api-team-invite`. The Stripe customer id is read from `tenants` filtered by
 * that verified tenant id — never from the request body.
 */
export interface BillingPortalDeps {
  fetchImpl: StripeFetch;
  stripeSecretKey: string;
  /** Where the portal's "return to Heyloo" link goes — `${APP_BASE_URL}/dashboard/billing`. */
  returnUrl: string;
  logger: Logger;
}

export type BillingPortalResult =
  | { ok: true; status: 200; body: { url: string } }
  | { ok: false; status: number; error: string };

/** Runtime validator for the one Stripe field we depend on (Rule 1 boundary check). */
const PortalSessionSchema = z.object({ url: z.url() });

export async function createTenantBillingPortalSession(
  sql: SqlClient,
  tenantId: string,
  callerUserId: string,
  deps: BillingPortalDeps,
): Promise<BillingPortalResult> {
  const callerRows = await sql<{ role: string }>`
    select role from public.memberships
    where tenant_id = ${tenantId} and user_id = ${callerUserId}
    limit 1
  `;
  if (callerRows[0]?.role !== "owner") {
    return { ok: false, status: 403, error: "not_tenant_owner" };
  }

  const tenantRows = await sql<{ stripe_customer_id: string | null }>`
    select stripe_customer_id from public.tenants where id = ${tenantId} limit 1
  `;
  const customerId = tenantRows[0]?.stripe_customer_id;
  if (!tenantRows[0]) return { ok: false, status: 404, error: "not_found" };
  if (!customerId) {
    // No completed checkout yet — there is nothing to manage in Stripe.
    return { ok: false, status: 409, error: "no_billing_account" };
  }

  let session: { ok: boolean; status: number; body: unknown };
  try {
    session = await createBillingPortalSession(deps.fetchImpl, deps.stripeSecretKey, {
      customerId,
      returnUrl: deps.returnUrl,
    });
  } catch (err) {
    deps.logger.error("billing_portal_stripe_request_failed", {
      tenant_id: tenantId,
      error: String(err),
    });
    return { ok: false, status: 502, error: "portal_unavailable" };
  }

  const parsed = PortalSessionSchema.safeParse(session.body);
  if (!session.ok || !parsed.success) {
    deps.logger.error("billing_portal_session_rejected", {
      tenant_id: tenantId,
      stripe_status: session.status,
      // Stripe error bodies carry `error.message` / `error.code`, never secrets.
      stripe_error: (session.body as { error?: { code?: string; message?: string } } | undefined)
        ?.error,
    });
    return { ok: false, status: 502, error: "portal_unavailable" };
  }

  return { ok: true, status: 200, body: { url: parsed.data.url } };
}
