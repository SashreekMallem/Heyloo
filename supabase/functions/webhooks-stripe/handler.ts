import type { StripeEvent } from "../_shared/schemas/stripe-event.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";

/**
 * `/webhooks-stripe` (BACKEND_SPEC §7.9, E2E_FLOWS_AUDIT H3): the ONLY
 * live-network call this otherwise pure-DB-effects file makes is kicking
 * off the provisioning saga — injected so this stays unit-testable with a
 * mocked `sql` (the Deno `index.ts` wires the real `fetch` call against
 * `/functions/v1/api-provision` with the `PROVISION_INTERNAL_SECRET`
 * header, matching `api-provision/index.ts`'s own internal-call contract
 * exactly: header `x-internal-secret`, body `{tenant_id}`).
 */
export interface StripeEventDeps {
  invokeProvisioning: (
    tenantId: string,
  ) => Promise<{ ok: boolean; status?: number; error?: string }>;
}

const defaultStripeEventDeps: StripeEventDeps = {
  invokeProvisioning: async () => ({ ok: true }),
};

/**
 * `/webhooks-stripe` background processing (BACKEND_SPEC §7.4). The Deno
 * `index.ts` owns signature verification + `webhook_events` dedup +
 * fast-ack; this file is the pure-DB-effects branch per event type, unit
 * tested with a mocked `sql`.
 */
export async function processStripeEvent(
  sql: SqlClient,
  event: StripeEvent,
  logger: Logger,
  deps: StripeEventDeps = defaultStripeEventDeps,
): Promise<void> {
  const obj = event.data.object;

  switch (event.type) {
    case "checkout.session.completed": {
      const metadata = (obj["metadata"] ?? {}) as Record<string, string | undefined>;
      const customerId = typeof obj["customer"] === "string" ? obj["customer"] : null;
      const subscriptionId = typeof obj["subscription"] === "string" ? obj["subscription"] : null;

      if (metadata["tenant_id"]) {
        const tenantId = metadata["tenant_id"];
        await sql`
          update public.tenants
          set status = 'active', stripe_customer_id = coalesce(${customerId}, stripe_customer_id),
              stripe_subscription_id = coalesce(${subscriptionId}, stripe_subscription_id)
          where id = ${tenantId}
        `;

        // Signup/subscription checkout — kicks off the provisioning saga
        // (BACKEND_SPEC §7.9) if not already started; the saga itself is
        // idempotent/re-entrant, so this call is safe to fire even if a
        // provisioning_runs row already exists. Skip the network round trip
        // entirely once this tenant has already published successfully.
        const publishedRuns = await sql<{ status: string }>`
          select status from public.provisioning_runs where tenant_id = ${tenantId} and step = 'publish_agent'
        `;
        if (publishedRuns[0]?.status !== "succeeded") {
          const invoked = await deps.invokeProvisioning(tenantId);
          if (!invoked.ok) {
            logger.error("provisioning_invoke_failed", {
              tenant_id: tenantId,
              status: invoked.status,
              error: invoked.error,
            });
            const invokeError = `provisioning_invoke_failed: ${invoked.error ?? invoked.status ?? "unknown"}`;
            await sql`
              insert into public.provisioning_runs (tenant_id, step, status, error, attempts, updated_at)
              values (${tenantId}, 'tenant_finalize', 'failed', ${invokeError}, 1, now())
              on conflict (tenant_id, step) do update set
                status = 'failed', error = excluded.error,
                attempts = provisioning_runs.attempts + 1, updated_at = now()
            `;
            await sql`
              insert into public.alerts (rule, severity, tenant_id, payload)
              values (
                'provisioning_invoke_failed', 'critical', ${tenantId},
                ${{ status: invoked.status ?? null, error: invoked.error ?? null }}::jsonb
              )
            `;
          }
        }
      }

      if (metadata["order_id"] || metadata["booking_id"]) {
        // Phone-payment checkout (MASTER_SPEC §3.2) — matched by metadata,
        // not by amount alone, since a race between two links must not
        // cross-mark the wrong order/booking.
        await sql`
          update public.payment_links
          set status = 'paid'
          where stripe_checkout_session_id = ${typeof obj["id"] === "string" ? obj["id"] : ""}
        `;
        if (metadata["order_id"]) {
          await sql`update public.orders set status = 'confirmed' where id = ${metadata["order_id"]}`;
        }
        if (metadata["booking_id"]) {
          await sql`update public.bookings set status = 'confirmed' where id = ${metadata["booking_id"]}`;
        }
      }
      return;
    }

    case "customer.subscription.updated": {
      const status = typeof obj["status"] === "string" ? obj["status"] : null;
      const customerId = typeof obj["customer"] === "string" ? obj["customer"] : null;
      if (!customerId || !status) return;
      const mapped =
        status === "past_due"
          ? "past_due"
          : status === "paused"
            ? "paused"
            : status === "active"
              ? "active"
              : null;
      if (!mapped) return;
      await sql`
        update public.tenants set status = ${mapped} where stripe_customer_id = ${customerId}
      `;
      return;
    }

    case "customer.subscription.deleted": {
      const customerId = typeof obj["customer"] === "string" ? obj["customer"] : null;
      if (!customerId) return;
      await sql`update public.tenants set status = 'canceled' where stripe_customer_id = ${customerId}`;
      // Offboarding wind-down (number port-out SLA, data export, G7) is
      // handled by a dedicated job, not inline here — this only flips the
      // status flag that job polls on.
      return;
    }

    case "invoice.paid": {
      const stripeInvoiceId = typeof obj["id"] === "string" ? obj["id"] : null;
      const customerId = typeof obj["customer"] === "string" ? obj["customer"] : null;
      if (!stripeInvoiceId) return;
      await sql`
        update public.billing_invoices set status = 'paid' where stripe_invoice_id = ${stripeInvoiceId}
      `;
      // Dunning reactivation (BACKEND_SPEC §8/§10.2, docs/BUILD_NOTES.md T4
      // entry): a payment that clears while the tenant was `past_due`
      // reactivates it here directly, belt-and-suspenders alongside
      // `customer.subscription.updated`'s own status sync below (Stripe
      // fires both events on a successful dunning retry, and this webhook
      // handler processes each idempotently via `webhook_events`, so acting
      // on both is safe, never a double-transition risk).
      if (customerId) {
        await sql`
          update public.tenants set status = 'active'
          where stripe_customer_id = ${customerId} and status = 'past_due'
        `;
      }
      return;
    }

    case "invoice.payment_failed": {
      const stripeInvoiceId = typeof obj["id"] === "string" ? obj["id"] : null;
      const customerId = typeof obj["customer"] === "string" ? obj["customer"] : null;
      if (!stripeInvoiceId) return;
      await sql`
        update public.billing_invoices set status = 'past_due' where stripe_invoice_id = ${stripeInvoiceId}
      `;
      // Dunning flow entry (BACKEND_SPEC §7.4/§10.2 `dunning_payment_failed`
      // template + "tenant-facing banner + email"): enqueue the email
      // immediately rather than waiting on the messages_outbound worker to
      // discover the status change on its own — there IS no such polling
      // path today (the worker only drains rows it's handed), so this is
      // the actual enqueue point, not a redundant one.
      if (customerId) {
        const tenantRows = await sql<{ id: string }>`
          select id from public.tenants where stripe_customer_id = ${customerId} limit 1
        `;
        const tenantId = tenantRows[0]?.id;
        if (tenantId) {
          await sql`
            insert into public.messages_outbound (tenant_id, channel, recipient, template_key, payload)
            select ${tenantId}, 'email', email, 'dunning_payment_failed', '{}'::jsonb
            from auth.users u
            join public.memberships m on m.user_id = u.id
            where m.tenant_id = ${tenantId} and m.role = 'owner'
            limit 1
          `;
        }
      }
      return;
    }

    case "charge.succeeded":
    case "payout.paid": {
      const chargeId = typeof obj["id"] === "string" ? obj["id"] : null;
      const balanceTransactionId =
        typeof obj["balance_transaction"] === "string" ? obj["balance_transaction"] : null;
      const customerId = typeof obj["customer"] === "string" ? obj["customer"] : null;
      if (!customerId) return;
      const tenantRows = await sql<{ id: string }>`
        select id from public.tenants where stripe_customer_id = ${customerId} limit 1
      `;
      const tenantId = tenantRows[0]?.id;
      if (!tenantId) return;
      // Actual fee/net come from the balance_transaction, fetched
      // separately (index.ts's job, since it needs a live Stripe API call,
      // not something this pure-DB function does) — this insert is a
      // placeholder row updated once that fetch completes.
      await sql`
        insert into public.payment_processing_events (
          tenant_id, stripe_charge_id, stripe_balance_transaction_id, method, fee_cents, net_cents, occurred_at
        ) values (
          ${tenantId}, ${chargeId}, ${balanceTransactionId}, 'card', 0, 0, now()
        )
      `;
      return;
    }

    // Referral anti-fraud clawback (SYSTEM_DESIGN §6/§10 G34: "clawback on
    // refund/chargeback of the referred account", E2E_FLOWS_AUDIT H1). A
    // `charge.refunded`/`charge.dispute.created` event on the REFERRED
    // tenant's own subscription charge reverses that tenant's referral —
    // never a customer-facing phone-payment refund, since those charges'
    // `customer`/`payment_processing_events.tenant_id` never resolve to a
    // `tenants.stripe_customer_id` in the first place.
    case "charge.refunded": {
      const customerId = typeof obj["customer"] === "string" ? obj["customer"] : null;
      if (!customerId) return;
      const tenantRows = await sql<{ id: string }>`
        select id from public.tenants where stripe_customer_id = ${customerId} limit 1
      `;
      const tenantId = tenantRows[0]?.id;
      if (!tenantId) return;
      // Per-invoice clawback (GAP_REGISTER Cluster G item 1): a refunded
      // charge tied to a specific invoice (Stripe's Charge object carries
      // `invoice` when the charge paid one) only reverses THAT invoice's
      // period-scoped recurring commission_events row(s)
      // (job-commission-accrual), not every accrual this referral has ever
      // earned. A refund with no resolvable invoice/period (e.g. a
      // standalone charge, or the pre-existing period-less flat
      // qualification bonus) falls back to the prior full-clawback
      // behavior — reversing every non-clawed-back commission_events row
      // for the referral — which stays correct for that flat, one-time
      // mechanism.
      const period = await resolveInvoicePeriod(sql, obj["invoice"]);
      await clawBackReferral(sql, logger, tenantId, event.type, period);
      return;
    }

    case "charge.dispute.created": {
      // The Dispute object itself carries no `customer` field (only
      // `charge`/`payment_intent`, VERIFY confirmed against Stripe's API
      // reference — docs.stripe.com is egress-blocked here, see
      // docs/VERIFY.md) — resolved via the charge->tenant mapping this same
      // handler already writes in `payment_processing_events` on
      // `charge.succeeded`, rather than an extra live Stripe API call.
      const chargeId = typeof obj["charge"] === "string" ? obj["charge"] : null;
      if (!chargeId) return;
      const tenantRows = await sql<{ tenant_id: string }>`
        select tenant_id from public.payment_processing_events where stripe_charge_id = ${chargeId} limit 1
      `;
      const tenantId = tenantRows[0]?.tenant_id;
      if (!tenantId) return;
      await clawBackReferral(sql, logger, tenantId, event.type);
      return;
    }

    default:
      logger.debug("stripe_event_unhandled_type", { type: event.type });
      return;
  }
}

/** Resolves a Stripe Charge's `invoice` reference (when present) to the
 * `billing_invoices.period_start` (first-of-month, matching
 * `job-commission-accrual`'s `commission_events.period` convention) that
 * invoice covers — used to scope a `charge.refunded` clawback to just that
 * period's recurring commission accrual. Returns `null` when the charge
 * carries no invoice, or the invoice isn't one this codebase billed (no
 * matching `billing_invoices` row) — the caller falls back to a full
 * clawback in that case, same as before this existed. */
async function resolveInvoicePeriod(sql: SqlClient, invoiceField: unknown): Promise<string | null> {
  const stripeInvoiceId = typeof invoiceField === "string" ? invoiceField : null;
  if (!stripeInvoiceId) return null;
  const rows = await sql<{ period_start: string }>`
    select period_start from public.billing_invoices where stripe_invoice_id = ${stripeInvoiceId} limit 1
  `;
  return rows[0]?.period_start ?? null;
}

async function clawBackReferral(
  sql: SqlClient,
  logger: Logger,
  referredTenantId: string,
  eventType: string,
  period: string | null = null,
): Promise<void> {
  const referralRows = await sql<{ id: string; referral_partner_id: string; status: string }>`
    select id, referral_partner_id, status from public.referrals
    where referred_tenant_id = ${referredTenantId}
  `;
  const referral = referralRows[0];
  if (!referral || referral.status === "clawed_back" || referral.status === "disqualified") return;

  // A per-invoice (period-scoped) clawback never flips the referral's own
  // status — the relationship keeps earning future months' commission; only
  // a full clawback (no resolvable period) marks the referral itself
  // clawed_back, matching the pre-existing "reverse the whole relationship"
  // semantics for the flat one-time bonus / an unattributable refund.
  if (!period) {
    await sql`update public.referrals set status = 'clawed_back' where id = ${referral.id}`;
  }

  const commissionRows = period
    ? await sql<{ id: string; amount_cents: number; status: string }>`
        select id, amount_cents, status from public.commission_events
        where referral_id = ${referral.id} and period = ${period}::date and status <> 'clawed_back'
      `
    : await sql<{ id: string; amount_cents: number; status: string }>`
        select id, amount_cents, status from public.commission_events
        where referral_id = ${referral.id} and status <> 'clawed_back'
      `;
  for (const commission of commissionRows) {
    await sql`update public.commission_events set status = 'clawed_back' where id = ${commission.id}`;
    if (commission.status === "paid") {
      // Already sent to the partner and counted toward their 1099-NEC
      // threshold (`referral_partners.ytd_payout_cents`) — reverse that
      // count even though recovering the actual PayPal payout is a manual
      // finance action outside this webhook's scope.
      await sql`
        update public.referral_partners
        set ytd_payout_cents = greatest(0, ytd_payout_cents - ${commission.amount_cents})
        where id = ${referral.referral_partner_id}
      `;
    }
  }

  logger.warn("referral_clawback", {
    tenant_id: referredTenantId,
    referral_id: referral.id,
    commission_events_reversed: commissionRows.length,
    event_type: eventType,
    period,
  });
}
