import type { StripeEvent } from "../_shared/schemas/stripe-event.js";
import type { Logger, SqlClient } from "../_shared/types.js";

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
): Promise<void> {
  const obj = event.data.object;

  switch (event.type) {
    case "checkout.session.completed": {
      const metadata = (obj["metadata"] ?? {}) as Record<string, string | undefined>;
      const customerId = typeof obj["customer"] === "string" ? obj["customer"] : null;
      const subscriptionId = typeof obj["subscription"] === "string" ? obj["subscription"] : null;

      if (metadata["tenant_id"]) {
        // Signup/subscription checkout — kicks off the provisioning saga
        // (BACKEND_SPEC §7.9) if not already started; the saga itself is
        // idempotent/re-entrant, so this call is safe to fire even if a
        // provisioning_runs row already exists.
        await sql`
          update public.tenants
          set status = 'active', stripe_customer_id = coalesce(${customerId}, stripe_customer_id),
              stripe_subscription_id = coalesce(${subscriptionId}, stripe_subscription_id)
          where id = ${metadata["tenant_id"]}
        `;
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
      if (!stripeInvoiceId) return;
      await sql`
        update public.billing_invoices set status = 'paid' where stripe_invoice_id = ${stripeInvoiceId}
      `;
      return;
    }

    case "invoice.payment_failed": {
      const stripeInvoiceId = typeof obj["id"] === "string" ? obj["id"] : null;
      if (!stripeInvoiceId) return;
      await sql`
        update public.billing_invoices set status = 'past_due' where stripe_invoice_id = ${stripeInvoiceId}
      `;
      // Dunning email fan-out happens via the messages_outbound worker
      // reading this status change, not inline here.
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

    default:
      logger.debug("stripe_event_unhandled_type", { type: event.type });
      return;
  }
}
