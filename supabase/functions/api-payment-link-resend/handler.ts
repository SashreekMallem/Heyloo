import type { StripeFetch } from "../_shared/providers/stripe.ts";
import { createCheckoutSession } from "../_shared/providers/stripe.ts";
import { enqueue, QUEUE_NAMES } from "../_shared/queue.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";

/**
 * `api-payment-link-resend` (MASTER_SPEC §3.2/§3.10, docs/audit/
 * FIX_REQUESTS.md — cluster D's contract, this function was the missing
 * half). A Stripe Checkout Session's own `url` can't be re-fetched after
 * creation and the session expires by default, so "resend" necessarily
 * means minting a fresh Checkout Session for the same amount/purpose/
 * order/booking — mirrors `voice-tools/tools/send_payment_link.ts`'s
 * `createCheckoutSession` call exactly, just driven by a dashboard action
 * instead of a live call, so the recipient phone is looked up from the
 * linked order/booking's customer rather than passed in directly.
 */
export interface PaymentLinkResendDeps {
  fetchImpl: StripeFetch;
  stripeSecretKey: string;
  successUrl: string;
  cancelUrl: string;
  logger: Logger;
}

export type PaymentLinkResendResult =
  | { ok: true; status: 200; body: { resent: true } }
  | { ok: false; status: number; error: string };

interface PaymentLinkRow {
  id: string;
  order_id: string | null;
  booking_id: string | null;
  amount_cents: number;
  purpose: "order" | "deposit" | "noshow_fee";
  status: string;
  recipient_phone: string | null;
}

export async function resendPaymentLink(
  sql: SqlClient,
  tenantId: string,
  paymentLinkId: string,
  deps: PaymentLinkResendDeps,
): Promise<PaymentLinkResendResult> {
  const rows = await sql<PaymentLinkRow>`
    select
      pl.id, pl.order_id, pl.booking_id, pl.amount_cents, pl.purpose, pl.status,
      coalesce(oc.phone_e164, bc.phone_e164) as recipient_phone
    from public.payment_links pl
    left join public.orders o on o.id = pl.order_id
    left join public.customers oc on oc.id = o.customer_id
    left join public.bookings b on b.id = pl.booking_id
    left join public.customers bc on bc.id = b.customer_id
    where pl.id = ${paymentLinkId} and pl.tenant_id = ${tenantId}
    limit 1
  `;
  const link = rows[0];
  if (!link) return { ok: false, status: 404, error: "not_found" };
  if (link.status === "paid") return { ok: false, status: 409, error: "already_paid" };
  if (!link.recipient_phone) {
    deps.logger.warn("payment_link_resend_no_recipient", {
      tenant_id: tenantId,
      payment_link_id: paymentLinkId,
    });
    return { ok: false, status: 422, error: "no_recipient_phone" };
  }

  const session = await createCheckoutSession(deps.fetchImpl, deps.stripeSecretKey, {
    mode: "payment",
    successUrl: deps.successUrl,
    cancelUrl: deps.cancelUrl,
    amountCents: link.amount_cents,
    currency: "usd",
    productName:
      link.purpose === "order"
        ? "Order payment"
        : link.purpose === "deposit"
          ? "Booking deposit"
          : "No-show fee",
    metadata: {
      tenant_id: tenantId,
      ...(link.order_id ? { order_id: link.order_id } : {}),
      ...(link.booking_id ? { booking_id: link.booking_id } : {}),
      purpose: link.purpose,
    },
  });

  if (!session.ok) {
    deps.logger.error("payment_link_resend_stripe_error", {
      tenant_id: tenantId,
      payment_link_id: paymentLinkId,
      status: session.status,
      body: session.body,
    });
    return { ok: false, status: 502, error: "stripe_error" };
  }

  const body = session.body as { id?: string; url?: string; expires_at?: number };
  if (!body.id || !body.url) {
    deps.logger.error("payment_link_resend_stripe_missing_fields", { body });
    return { ok: false, status: 502, error: "stripe_error" };
  }
  const expiresAt =
    typeof body.expires_at === "number" ? new Date(body.expires_at * 1000).toISOString() : null;

  await sql`
    update public.payment_links
    set stripe_checkout_session_id = ${body.id}, status = 'sent', expires_at = ${expiresAt}
    where id = ${paymentLinkId} and tenant_id = ${tenantId}
  `;

  const messageRows = await sql<{ id: string }>`
    insert into public.messages_outbound (
      tenant_id, channel, recipient, template_key, payload, related_booking_id, related_order_id
    ) values (
      ${tenantId}, 'sms', ${link.recipient_phone}, 'payment_link',
      ${{ url: body.url, amount_cents: link.amount_cents }}::jsonb,
      ${link.booking_id}, ${link.order_id}
    )
    returning id
  `;
  const message = messageRows[0];
  if (message) {
    await enqueue(sql, QUEUE_NAMES.messagesOutbound, { message_id: message.id });
  }

  return { ok: true, status: 200, body: { resent: true } };
}
