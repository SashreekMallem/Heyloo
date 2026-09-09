import type { z } from "zod";
import { verifyBookingIdentity } from "../../_shared/identity-verification.ts";
import { enqueue, QUEUE_NAMES } from "../../_shared/queue.ts";
import type { CancelBookingArgsSchema } from "../../_shared/schemas/voice-tools.ts";
import type { SqlClient } from "../../_shared/types.ts";
import type { CallContext } from "../context.ts";

type Args = z.infer<typeof CancelBookingArgsSchema>;

export type CancelBookingResult =
  | { cancelled: true }
  | { cancelled: false; reason: "not_found" | "identity_verification_failed" };

/**
 * BACKEND_SPEC §7.2.4 + MASTER_SPEC §3.7 identity fallback. Cancelling an
 * already-cancelled booking is a no-op (status check folded into the WHERE
 * clause, not a separate check-then-update). The availability-invalidation
 * trigger (§3.5) frees the slot; this handler enqueues the cancellation-
 * confirmation SMS (never sends inline — hot-path discipline) and, per
 * MASTER_SPEC §3.4, matching waitlist entries are notified by a DB trigger
 * on this same status transition (not this handler's concern). When the
 * live caller's number differs from the booking's own customer number,
 * `args.verify` must match before any write happens.
 */
export async function cancelBooking(
  sql: SqlClient,
  ctx: CallContext,
  args: Args,
): Promise<CancelBookingResult> {
  const bookingRows = await sql<{
    id: string;
    status: string;
    start_at: string;
    customer_id: string | null;
    customer_phone: string | null;
    customer_name: string | null;
  }>`
    select b.id, b.status, b.start_at, b.customer_id, c.phone_e164 as customer_phone, c.name as customer_name
    from public.bookings b
    left join public.customers c on c.id = b.customer_id
    where b.id = ${args.booking_id} and b.tenant_id = ${ctx.tenantId}
  `;
  const booking = bookingRows[0];
  if (!booking) return { cancelled: false, reason: "not_found" };

  if (booking.status === "cancelled") {
    // Idempotent no-op — already cancelled, no identity check needed since
    // there's nothing left to protect.
    return { cancelled: true };
  }

  const identity = verifyBookingIdentity({
    callerNumber: ctx.callerNumber,
    customerPhone: booking.customer_phone,
    customerName: booking.customer_name,
    bookingStartAt: booking.start_at,
    ...(args.verify ? { verify: args.verify } : {}),
  });
  if (!identity.ok) {
    return { cancelled: false, reason: "identity_verification_failed" };
  }

  const rows = await sql<{ id: string; customer_id: string | null }>`
    update public.bookings
    set status = 'cancelled', cancelled_at = now(), cancel_reason = ${args.reason ?? null},
        identity_verified_by = ${identity.verifiedBy}
    where id = ${args.booking_id} and tenant_id = ${ctx.tenantId} and status != 'cancelled'
    returning id, customer_id
  `;

  const row = rows[0];
  if (row) {
    const messageRows = await sql<{ id: string }>`
      insert into public.messages_outbound (tenant_id, channel, recipient, template_key, payload, related_booking_id)
      select ${ctx.tenantId}, 'sms', c.phone_e164, 'booking_cancelled', '{}'::jsonb, ${row.id}
      from public.customers c
      where c.id = ${row.customer_id}
      returning id
    `;
    const message = messageRows[0];
    if (message) {
      await enqueue(sql, QUEUE_NAMES.messagesOutbound, { message_id: message.id });
    }
  }

  return { cancelled: true };
}
