import type { z } from "zod";
import { normalizeE164 } from "../../_shared/phone.ts";
import type { StripeFetch } from "../../_shared/providers/stripe.ts";
import { createCheckoutSession } from "../../_shared/providers/stripe.ts";
import { enqueue, QUEUE_NAMES } from "../../_shared/queue.ts";
import type { SendPaymentLinkArgsSchema } from "../../_shared/schemas/voice-tools.ts";
import type { Logger, SqlClient } from "../../_shared/types.ts";
import type { CallContext } from "../context.ts";

type Args = z.infer<typeof SendPaymentLinkArgsSchema>;

export type SendPaymentLinkResult =
  | { queued: true; message_id: string }
  | { queued: false; reason: "invalid_phone" | "invalid_amount" | "stripe_error" };

/**
 * MASTER_SPEC §3.2 `send_payment_link` tool: creates a Stripe Checkout
 * Session for the order/deposit/no-show-fee amount, writes `payment_links`,
 * and enqueues an SMS carrying the Checkout URL — the actual send happens
 * in the `messages_outbound_queue` worker, same fast-tool-call discipline as
 * `send_sms_confirmation`. No card numbers are ever spoken/stored (PCI
 * stance unchanged) — Stripe hosts the entire payment page.
 */
export async function sendPaymentLink(
  sql: SqlClient,
  ctx: CallContext,
  args: Args,
  deps: {
    fetchImpl: StripeFetch;
    stripeSecretKey: string;
    successUrl: string;
    cancelUrl: string;
    logger: Logger;
  },
): Promise<SendPaymentLinkResult> {
  const phone = normalizeE164(args.phone);
  if (!phone) return { queued: false, reason: "invalid_phone" };

  let amountCents = args.amount_cents;
  if (amountCents === undefined && args.order_id) {
    const orderRows = await sql<{ total_cents: number }>`
      select total_cents from public.orders where id = ${args.order_id} and tenant_id = ${ctx.tenantId}
    `;
    amountCents = orderRows[0]?.total_cents;
  }
  if (!amountCents || amountCents <= 0) return { queued: false, reason: "invalid_amount" };

  const session = await createCheckoutSession(deps.fetchImpl, deps.stripeSecretKey, {
    mode: "payment",
    successUrl: deps.successUrl,
    cancelUrl: deps.cancelUrl,
    amountCents,
    currency: "usd",
    productName:
      args.purpose === "order"
        ? "Order payment"
        : args.purpose === "deposit"
          ? "Booking deposit"
          : "No-show fee",
    metadata: {
      tenant_id: ctx.tenantId,
      ...(args.order_id ? { order_id: args.order_id } : {}),
      ...(args.booking_id ? { booking_id: args.booking_id } : {}),
      purpose: args.purpose,
    },
  });

  if (!session.ok) {
    deps.logger.error("send_payment_link_stripe_error", {
      status: session.status,
      body: session.body,
    });
    return { queued: false, reason: "stripe_error" };
  }

  const body = session.body as { id?: string; url?: string };
  if (!body.id || !body.url) {
    deps.logger.error("send_payment_link_stripe_missing_fields", { body });
    return { queued: false, reason: "stripe_error" };
  }

  await sql`
    insert into public.payment_links (
      tenant_id, order_id, booking_id, stripe_checkout_session_id, amount_cents, purpose, status
    ) values (
      ${ctx.tenantId}, ${args.order_id ?? null}, ${args.booking_id ?? null}, ${body.id}, ${amountCents},
      ${args.purpose}, 'pending'
    )
  `;

  const messageRows = await sql<{ id: string }>`
    insert into public.messages_outbound (
      tenant_id, channel, recipient, template_key, payload, related_booking_id, related_order_id
    ) values (
      ${ctx.tenantId}, 'sms', ${phone}, 'payment_link', ${{ url: body.url, amount_cents: amountCents }}::jsonb,
      ${args.booking_id ?? null}, ${args.order_id ?? null}
    )
    returning id
  `;
  const message = messageRows[0];
  if (message) {
    await enqueue(sql, QUEUE_NAMES.messagesOutbound, { message_id: message.id });
  }
  if (!message) return { queued: false, reason: "stripe_error" };

  return { queued: true, message_id: message.id };
}
