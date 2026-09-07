import type { z } from "zod";
import { verifyBookingIdentity } from "../../_shared/identity-verification.js";
import type { UpdateBookingArgsSchema } from "../../_shared/schemas/voice-tools.js";
import type { SqlClient } from "../../_shared/types.js";
import type { CallContext } from "../context.js";

type Args = z.infer<typeof UpdateBookingArgsSchema>;

export type UpdateBookingResult =
  | { confirmed: true; start: string; end: string }
  | { confirmed: false; reason: "slot_taken" | "not_found" | "identity_verification_failed" };

const EXCLUSION_VIOLATION = "23P01";

function isPgError(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === code;
}

/**
 * BACKEND_SPEC §7.2.3 (reschedule) + MASTER_SPEC §3.7 identity fallback.
 * The exclusion constraint re-validates on UPDATE automatically (same GIST
 * constraint as `create_booking`); the availability-invalidation trigger
 * (BACKEND_SPEC §3.5) re-flips the old and new slots. Scoped to `tenant_id`
 * on every write (CLAUDE.md Rule 2). When the live caller's number differs
 * from the booking's own customer number, `args.verify` (full name +
 * claimed appointment time) must match before any write happens — never
 * reads back other PII in the process.
 */
export async function updateBooking(
  sql: SqlClient,
  ctx: CallContext,
  args: Args,
): Promise<UpdateBookingResult> {
  const bookingRows = await sql<{
    id: string;
    start_at: string;
    customer_phone: string | null;
    customer_name: string | null;
  }>`
    select b.id, b.start_at, c.phone_e164 as customer_phone, c.name as customer_name
    from public.bookings b
    left join public.customers c on c.id = b.customer_id
    where b.id = ${args.booking_id} and b.tenant_id = ${ctx.tenantId} and b.status = 'confirmed'
  `;
  const booking = bookingRows[0];
  if (!booking) return { confirmed: false, reason: "not_found" };

  const identity = verifyBookingIdentity({
    callerNumber: ctx.callerNumber,
    customerPhone: booking.customer_phone,
    customerName: booking.customer_name,
    bookingStartAt: booking.start_at,
    ...(args.verify ? { verify: args.verify } : {}),
  });
  if (!identity.ok) {
    return { confirmed: false, reason: "identity_verification_failed" };
  }

  try {
    const rows = await sql<{ id: string; start_at: string; end_at: string }>`
      update public.bookings
      set start_at = ${args.new_start}, end_at = ${args.new_end}, identity_verified_by = ${identity.verifiedBy}
      where id = ${args.booking_id} and tenant_id = ${ctx.tenantId} and status = 'confirmed'
      returning id, start_at, end_at
    `;
    const row = rows[0];
    if (!row) return { confirmed: false, reason: "not_found" };
    return { confirmed: true, start: row.start_at, end: row.end_at };
  } catch (err) {
    if (isPgError(err, EXCLUSION_VIOLATION)) {
      return { confirmed: false, reason: "slot_taken" };
    }
    throw err;
  }
}
