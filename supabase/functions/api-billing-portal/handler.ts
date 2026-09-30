import type { StripeFetch } from "../_shared/providers/stripe.ts";
import { createBillingPortalSession } from "../_shared/providers/stripe.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";

/**
 * `/api-billing-portal` (QA-1 SEC-08): "Manage payment method" on the
 * dashboard billing page. The web route (`/api/billing/portal`) proxies here
 * with the caller's own access token; this function is what authorizes.
 *
 * Authorization: the user id comes from the verified JWT (`sub`), never from
 * the body. The tenant is resolved from `memberships` and the caller must be
 * an `owner` or `admin` of it: a plain `member` may not open the portal (it
 * can change the card and cancel the subscription). A body `tenant_id` is
 * only a selector among the caller's OWN owner/admin memberships, so it can
 * never widen access to another tenant. The Stripe customer is read from
 * `tenants.stripe_customer_id`, never from the request.
 */
export interface BillingPortalDeps {
  stripeFetch: StripeFetch;
  stripeSecretKey: string;
  /** `APP_BASE_URL` (no trailing slash needed); the portal's return link is
   * `${appBaseUrl}/dashboard/billing`. */
  appBaseUrl: string;
  logger: Logger;
}

export type BillingPortalResult =
  | { ok: true; status: 200; body: { url: string } }
  | {
      ok: false;
      status: 400 | 403 | 409 | 502;
      error: "invalid_request" | "forbidden" | "no_billing_account" | "portal_unavailable";
    };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface MembershipRow {
  tenant_id: string;
  role: string;
  stripe_customer_id: string | null;
}

export async function handleBillingPortal(
  sql: SqlClient,
  userId: string,
  body: unknown,
  deps: BillingPortalDeps,
): Promise<BillingPortalResult> {
  const requestedTenant =
    typeof body === "object" && body !== null
      ? (body as { tenant_id?: unknown }).tenant_id
      : undefined;
  if (
    requestedTenant !== undefined &&
    (typeof requestedTenant !== "string" || !UUID_RE.test(requestedTenant))
  ) {
    return { ok: false, status: 400, error: "invalid_request" };
  }

  const rows = await sql<MembershipRow>`
    select m.tenant_id, m.role, t.stripe_customer_id
    from public.memberships m
    join public.tenants t on t.id = m.tenant_id
    where m.user_id = ${userId}
      and m.role in ('owner', 'admin')
      and (${requestedTenant ?? null}::uuid is null or m.tenant_id = ${requestedTenant ?? null}::uuid)
    order by (m.role = 'owner') desc, m.tenant_id
    limit 1
  `;
  const membership = rows[0];
  if (!membership) return { ok: false, status: 403, error: "forbidden" };
  if (!membership.stripe_customer_id) {
    return { ok: false, status: 409, error: "no_billing_account" };
  }

  const returnUrl = `${deps.appBaseUrl.replace(/\/+$/, "")}/dashboard/billing`;
  const res = await createBillingPortalSession(deps.stripeFetch, deps.stripeSecretKey, {
    customerId: membership.stripe_customer_id,
    returnUrl,
  });
  const url = (res.body as { url?: unknown } | undefined)?.url;
  if (!res.ok || typeof url !== "string") {
    deps.logger.error("billing_portal_session_failed", {
      tenant_id: membership.tenant_id,
      status: res.status,
    });
    return { ok: false, status: 502, error: "portal_unavailable" };
  }
  deps.logger.info("billing_portal_session_created", { tenant_id: membership.tenant_id });
  return { ok: true, status: 200, body: { url } };
}
