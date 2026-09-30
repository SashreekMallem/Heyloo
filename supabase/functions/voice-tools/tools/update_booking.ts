import type { z } from "zod";
import { enqueueAdapterPush } from "../../_shared/adapter-push.ts";
import { verifyBookingIdentity } from "../../_shared/identity-verification.ts";
import type { UpdateBookingArgsSchema } from "../../_shared/schemas/voice-tools.ts";
import type { SqlClient } from "../../_shared/types.ts";
import type { CallContext } from "../context.ts";
import { MANUAL_MODE_CHANGE_MESSAGE } from "../manual-mode.ts";
import { toTenantLocalIso } from "./local-time.ts";
import { normalizeInstant } from "./time-args.ts";

type Args = z.infer<typeof UpdateBookingArgsSchema>;

export type UpdateBookingResult =
  | { confirmed: true; start: string; end: string }
  | { confirmed: false; reason: "slot_taken" | "not_found" | "identity_verification_failed" }
  | {
      confirmed: false;
      reason: "start_in_past" | "too_soon" | "not_available" | "invalid_time";
      message: string;
    }
  | { confirmed: false; reason: "manual_mode"; message: string };

const EXCLUSION_VIOLATION = "23P01";

/** F-AUTO-RESCHED-1: model-facing instructions for a refused reschedule. Each says nothing was changed. */
export const RESCHEDULE_START_IN_PAST_MESSAGE =
  "That time has already passed, so the booking was NOT changed. Call check_availability for the day the caller wants and offer one of the upcoming times it returns.";
export const RESCHEDULE_TOO_SOON_MESSAGE =
  "That time is sooner than the business takes bookings for, so the booking was NOT changed. Call check_availability again and offer the caller one of the times it returns.";
export const RESCHEDULE_NOT_AVAILABLE_MESSAGE =
  "That new time is not open (outside opening hours, no such slot, or not offered), so the booking was NOT changed and it is still at its original time. Call check_availability for the day the caller wants and offer only a time it returns.";
export const RESCHEDULE_INVALID_TIME_MESSAGE =
  "The new time could not be read, so the booking was NOT changed. Call update_booking again with new_start as a full ISO 8601 timestamp with the business's UTC offset.";

function isPgError(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === code;
}

interface PreflightRow {
  id: string;
  start_at: string;
  customer_phone: string | null;
  customer_name: string | null;
  tz?: string | null;
  start_in_past?: boolean | null;
  too_soon?: boolean | null;
  slots_cover?: boolean | null;
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
 *
 * F-AUTO-RESCHED-1: the exclusion constraint was the ONLY guard, so a
 * reschedule could land in the past, outside opening hours or in a slot never
 * offered, and a model-supplied `new_end` turned a 30-minute booking into 60.
 * Now (one statement, alongside the booking read):
 *  - the booking keeps its own length: `new_end` is `new_start` plus the
 *    booking's current `end_at - start_at`, computed in SQL (the model's
 *    `new_end` is only schema-required and is ignored);
 *  - the new start is not in the past and respects the owner's minimum notice
 *    (`tenants.booking_min_notice_minutes`), exactly as `create_booking` does,
 *    with the same day-length (motel night) handling;
 *  - the new window must lie inside this booking's resource's availability
 *    slots, counting the booking's own current slot as open (so moving a
 *    booking by 15 minutes is not refused for overlapping itself). Another
 *    booking in the way is still the exclusion constraint's job (`slot_taken`).
 */
export async function updateBooking(
  sql: SqlClient,
  ctx: CallContext,
  args: Args,
): Promise<UpdateBookingResult> {
  // VOICE-ALERTS-1 review: Manual Mode also means no rescheduling. Refused
  // before any SQL (the flag rode in on the call context).
  if (ctx.manualMode) {
    return { confirmed: false, reason: "manual_mode", message: MANUAL_MODE_CHANGE_MESSAGE };
  }
  // Same normalization `create_booking` applies: an unparseable time is
  // answered here, never bound (the driver would throw on the hot path).
  const newStart = normalizeInstant(args.new_start);
  if (newStart === null) {
    return {
      confirmed: false,
      reason: "invalid_time",
      message: RESCHEDULE_INVALID_TIME_MESSAGE,
    };
  }

  const bookingRows = await sql<PreflightRow>`
    /* update_booking:preflight */
    with tn as (
      -- Read via to_jsonb(t) ->> ..., not as a column, so this keeps working on
      -- a database where 20260929140000_tenant_booking_rules.sql is not applied.
      select timezone, (to_jsonb(t) ->> 'booking_min_notice_minutes')::int as notice
      from public.tenants t where t.id = ${ctx.tenantId}
    )
    select b.id, b.start_at, c.phone_e164 as customer_phone, c.name as customer_name,
      (select timezone from tn) as tz,
      case
        when b.end_at - b.start_at >= interval '23 hours'
          then ${newStart}::timestamptz < (
            date_trunc('day', now() at time zone (select timezone from tn))
              at time zone (select timezone from tn)
          )
        else ${newStart}::timestamptz < now()
      end as start_in_past,
      case
        when (select notice from tn) is null then false
        when b.end_at - b.start_at >= interval '23 hours' then false
        else ${newStart}::timestamptz < now() + make_interval(mins => (select notice from tn))
      end as too_soon,
      coalesce((
        select tstzmultirange(
                 tstzrange(${newStart}::timestamptz, ${newStart}::timestamptz + (b.end_at - b.start_at))
               ) <@ range_agg(s.slot_range)
        from public.availability_slots s
        where s.tenant_id = ${ctx.tenantId} and s.resource_id = b.resource_id
          and (s.is_available or s.slot_range && b.during)
          and s.slot_range && tstzrange(${newStart}::timestamptz, ${newStart}::timestamptz + (b.end_at - b.start_at))
      ), false) as slots_cover
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

  if (booking.start_in_past) {
    return {
      confirmed: false,
      reason: "start_in_past",
      message: RESCHEDULE_START_IN_PAST_MESSAGE,
    };
  }
  if (booking.too_soon) {
    return { confirmed: false, reason: "too_soon", message: RESCHEDULE_TOO_SOON_MESSAGE };
  }
  if (booking.slots_cover !== true) {
    return {
      confirmed: false,
      reason: "not_available",
      message: RESCHEDULE_NOT_AVAILABLE_MESSAGE,
    };
  }

  try {
    const rows = await sql<{ id: string; start_at: string; end_at: string }>`
      update public.bookings
      set start_at = ${newStart}::timestamptz,
          end_at = ${newStart}::timestamptz + (end_at - start_at),
          identity_verified_by = ${identity.verifiedBy}
      where id = ${args.booking_id} and tenant_id = ${ctx.tenantId} and status = 'confirmed'
      returning id, start_at, end_at
    `;
    const row = rows[0];
    if (!row) return { confirmed: false, reason: "not_found" };

    // E2E_FLOWS_AUDIT B4 (producer side): reschedule path enqueues too.
    await enqueueAdapterPush(sql, {
      tenantId: ctx.tenantId,
      entityType: "booking",
      entityId: row.id,
      idempotencyKey: `${args.booking_id}:update:${newStart}`,
    });

    // The times the model speaks come back in the business's own timezone
    // (offset form), never as raw UTC.
    return {
      confirmed: true,
      start: String(toTenantLocalIso(row.start_at, booking.tz)),
      end: String(toTenantLocalIso(row.end_at, booking.tz)),
    };
  } catch (err) {
    if (isPgError(err, EXCLUSION_VIOLATION)) {
      return { confirmed: false, reason: "slot_taken" };
    }
    throw err;
  }
}
