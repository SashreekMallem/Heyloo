import type { z } from "zod";
import { enqueueAdapterPush } from "../../_shared/adapter-push.ts";
import { verifyBookingIdentity } from "../../_shared/identity-verification.ts";
import type { UpdateBookingArgsSchema } from "../../_shared/schemas/voice-tools.ts";
import type { SqlClient } from "../../_shared/types.ts";
import type { CallContext } from "../context.ts";
import { MANUAL_MODE_CHANGE_MESSAGE } from "../manual-mode.ts";
import {
  INVALID_TIME_MESSAGE,
  OUTSIDE_HOURS_MESSAGE,
  START_IN_PAST_MESSAGE,
  TOO_SOON_MESSAGE,
} from "./create_booking.ts";
import { toTenantLocalIso } from "./local-time.ts";
import { normalizeTimeRange } from "./time-args.ts";

type Args = z.infer<typeof UpdateBookingArgsSchema>;

export type UpdateBookingResult =
  | { confirmed: true; start: string; end: string }
  | { confirmed: false; reason: "slot_taken" | "not_found" | "identity_verification_failed" }
  | {
      confirmed: false;
      reason: "start_in_past" | "too_soon" | "outside_hours" | "invalid_time";
      message: string;
    }
  | { confirmed: false; reason: "manual_mode"; message: string };

interface BookingLookupRow {
  id: string;
  start_at: string;
  customer_phone: string | null;
  customer_name: string | null;
  tz?: string | null;
  start_in_past?: boolean;
  too_soon?: boolean;
  in_hours?: boolean;
}

const EXCLUSION_VIOLATION = "23P01";
const INVALID_DATETIME_FORMAT = "22007";
const DATETIME_FIELD_OVERFLOW = "22008";

function isPgError(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === code;
}

/** QA-1 BE-08: a confirmed time rendered in the tenant's timezone with its
 * UTC offset (same helper as create_booking), so the model never has to
 * convert a UTC value before speaking it. */
function localIso(value: string | Date, tz: string | null | undefined): string {
  const rendered = toTenantLocalIso(value, tz);
  return typeof rendered === "string" ? rendered : String(rendered);
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
 * QA-1 BE-07: the new time gets the same rules as `create_booking` (a
 * parseable range, not in the past, the owner's minimum notice, inside a real
 * availability slot of the booking's own resource) BEFORE the UPDATE, and the
 * confirmed times come back in the tenant's timezone (BE-08), never raw UTC.
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
  const when = normalizeTimeRange(args.new_start, args.new_end);
  if (!when) {
    return { confirmed: false, reason: "invalid_time", message: INVALID_TIME_MESSAGE };
  }

  let booking: BookingLookupRow | undefined;
  try {
    // One statement: the booking, its customer, and every time rule the new
    // range must satisfy (mirrors create_booking's preflight; the notice is
    // read via to_jsonb so an unapplied booking-rules migration cannot 42703).
    const bookingRows = await sql<BookingLookupRow>`
      /* update_booking:lookup */
      with tn as (
        select timezone, (to_jsonb(t) ->> 'booking_min_notice_minutes')::int as notice
        from public.tenants t where t.id = ${ctx.tenantId}
      )
      select b.id, b.start_at, c.phone_e164 as customer_phone, c.name as customer_name,
        (select timezone from tn) as tz,
        case
          when ${when.end}::timestamptz - ${when.start}::timestamptz >= interval '23 hours'
            then ${when.start}::timestamptz < (
              date_trunc('day', now() at time zone (select timezone from tn))
                at time zone (select timezone from tn)
            )
          else ${when.start}::timestamptz < now()
        end as start_in_past,
        case
          when (select notice from tn) is null then false
          when ${when.end}::timestamptz - ${when.start}::timestamptz >= interval '23 hours' then false
          else ${when.start}::timestamptz < now() + make_interval(mins => (select notice from tn))
        end as too_soon,
        exists (
          select 1 from public.availability_slots s
          where s.tenant_id = ${ctx.tenantId} and s.resource_id = b.resource_id
            and s.slot_range @> ${when.start}::timestamptz
            and (s.is_available or s.source = 'generated')
        ) as in_hours
      from public.bookings b
      left join public.customers c on c.id = b.customer_id
      where b.id = ${args.booking_id} and b.tenant_id = ${ctx.tenantId} and b.status = 'confirmed'
    `;
    booking = bookingRows[0];
  } catch (err) {
    if (isPgError(err, INVALID_DATETIME_FORMAT) || isPgError(err, DATETIME_FIELD_OVERFLOW)) {
      return { confirmed: false, reason: "invalid_time", message: INVALID_TIME_MESSAGE };
    }
    throw err;
  }
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

  // Identity first, so an unverified caller learns nothing about the booking
  // or the business's hours. Only an explicit `true` / `false` refuses, so a
  // database that cannot evaluate a rule never blocks a legitimate move.
  if (booking.start_in_past) {
    return { confirmed: false, reason: "start_in_past", message: START_IN_PAST_MESSAGE };
  }
  if (booking.too_soon) {
    return { confirmed: false, reason: "too_soon", message: TOO_SOON_MESSAGE };
  }
  if (booking.in_hours === false) {
    return { confirmed: false, reason: "outside_hours", message: OUTSIDE_HOURS_MESSAGE };
  }

  try {
    const rows = await sql<{ id: string; start_at: string; end_at: string }>`
      update public.bookings
      set start_at = ${when.start}, end_at = ${when.end}, identity_verified_by = ${identity.verifiedBy}
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
      idempotencyKey: `${args.booking_id}:update:${when.start}`,
    });

    return {
      confirmed: true,
      start: localIso(row.start_at, booking.tz),
      end: localIso(row.end_at, booking.tz),
    };
  } catch (err) {
    if (isPgError(err, EXCLUSION_VIOLATION)) {
      return { confirmed: false, reason: "slot_taken" };
    }
    throw err;
  }
}
