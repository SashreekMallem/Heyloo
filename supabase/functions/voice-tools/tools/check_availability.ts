import type { z } from "zod";
import type { CheckAvailabilityArgsSchema } from "../../_shared/schemas/voice-tools.ts";
import type { SqlClient } from "../../_shared/types.ts";
import type { CallContext } from "../context.ts";
import { toTenantLocalIso } from "./local-time.ts";
import { normalizeTimeRange } from "./time-args.ts";

type Args = z.infer<typeof CheckAvailabilityArgsSchema>;

interface SlotRow {
  resource_id: string;
  slot_start: string | Date;
  slot_end: string | Date;
  /** `tenants.timezone`, same value on every row (one initplan, no extra
   * round trip) — used only to render the returned times locally. */
  tz?: string | null;
}

/**
 * HOTPATH (docs/BUILD_NOTES.md) — minimum notice before a slot may be
 * offered. `availability_slots` is precomputed and never pruned, so without
 * a cutoff the tool offered slots that had already started: live, one
 * tenant had 1,252 elapsed slots still `is_available = true`, and the
 * result is ordered earliest-first with `limit 20`, so a "today" request got
 * this morning's slots first. Four judged runs booked a start 9-106 hours in
 * the past.
 *
 * 30 minutes is enough to reach an appointment-type business; restaurant
 * tables are commonly taken for "in 15 minutes". Day-length slots (motel
 * nights, which run local-midnight to local-midnight) are handled by the
 * `day slot` branch of the cutoff instead: tonight's room is still bookable
 * at 8 pm even though its slot started at midnight. HOTPATH-REVIEW: a
 * day-length slot is `>= interval '23 hours'`, not `'1 day'` (= 24 h),
 * because the spring-forward night is 23 hours long and was otherwise never
 * offered after local midnight (same threshold as create_booking).
 */
export const DEFAULT_MIN_NOTICE_MINUTES = 30;
const MIN_NOTICE_MINUTES_BY_VERTICAL: Record<string, number> = { restaurant: 15 };

export function minNoticeMinutes(vertical: string): number {
  return MIN_NOTICE_MINUTES_BY_VERTICAL[vertical] ?? DEFAULT_MIN_NOTICE_MINUTES;
}

export interface CheckAvailabilityResult {
  slots: { start: string; end: string; resource_id: string }[];
  none_available: boolean;
  nearest_alternative?: { start: string; end: string };
  /** HOTPATH-REVIEW: set only when the date range could not be read, in
   * which case nothing was queried. */
  reason?: "invalid_time";
  message?: string;
}

/** HOTPATH-REVIEW: the model-facing instruction for `reason: "invalid_time"`. */
export const INVALID_DATE_RANGE_MESSAGE =
  "The date range could not be read, so availability was NOT checked. Call check_availability again with date_range.start and date_range.end as full ISO 8601 timestamps with a UTC offset (for example 2026-09-29T00:00:00-04:00), with end not before start.";

/**
 * BACKEND_SPEC §7.2.1 — pure read against the precomputed
 * `availability_slots` table (SYSTEM_DESIGN §5: "hot query = one indexed
 * read, <10ms ... no tz conversion"). No side effects.
 *
 * The `resource_type`/`room_type`/`party_size` filters are expressed as
 * `(all null) or resource_id in (... every provided predicate ANDed ...)`
 * rather than an interpolated conditional SQL fragment — `SqlClient`
 * (types.ts) models postgres.js's tagged-template callable but not its
 * fragment-composition helper, so this stays one flat parameterized query.
 *
 * `room_type` (GAP_REGISTER.md §2 Motel item 2, `resources.room_type`)
 * narrows WITHIN `resource_type` (a motel's `resource_type` is always
 * `'room'`; `room_type` picks which tier, e.g. "queen") — previously
 * `offering_id` was accepted by this tool's schema but never used in the
 * SQL at all (a dead parameter); `room_type` is the register's chosen fix
 * since `resources` (not `offerings`) is what `availability_slots`
 * actually keys off of. `party_size` (GAP_REGISTER.md §2 Restaurant item
 * 3) filters to resources whose `capacity` can seat the party — previously
 * accepted by the schema but never applied.
 *
 * F13: the room-type filter is case-insensitive (the model passes the rate-table
 * name, "Standard queen room", where the resource says "standard queen room"), and it
 * is ignored when the tenant has configured NO room types at all: the portal never
 * required `resources.room_type` to match the rate table, and with the exact match
 * every motel that skipped it read as sold out. A tenant that HAS tiers still gets
 * an exact (case-insensitive) match, so a tier that does not exist stays unavailable.
 *
 * HOTPATH: both queries apply the same "not already started" cutoff, which
 * is timezone-independent because it compares `timestamptz` instants with
 * `now()`: a slot is offerable when it starts at least
 * `minNoticeMinutes(vertical)` from now, or — for a day-length slot (a
 * motel night) — when it has not yet ended by then. Returned times are
 * rendered in the tenant's own timezone with an explicit offset
 * (`toTenantLocalIso`).
 */
export async function checkAvailability(
  sql: SqlClient,
  ctx: CallContext,
  args: Args,
): Promise<CheckAvailabilityResult> {
  const resourceType = args.resource_type ?? null;
  const roomType = args.room_type ?? null;
  const partySize = args.party_size ?? null;

  const noticeMinutes = minNoticeMinutes(ctx.vertical);

  // HOTPATH-REVIEW (`time-args.ts`): never bind a time JavaScript cannot
  // parse; bind the normalized form, which is what postgres.js would send
  // for a valid input anyway.
  const range = normalizeTimeRange(args.date_range.start, args.date_range.end, {
    allowEmpty: true,
  });
  if (!range) {
    return {
      slots: [],
      none_available: true,
      reason: "invalid_time",
      message: INVALID_DATE_RANGE_MESSAGE,
    };
  }

  // VOICE-ALERTS-1: one statement per query, with the tenant's own row read
  // once in the `t` CTE (the timezone was already a per-query subselect):
  //  - `notice` is the owner's `tenants.booking_min_notice_minutes`, else the
  //    vertical default bound above. Read as `to_jsonb(t) ->> '...'` rather
  //    than as a column so this keeps answering (with the default) on a
  //    database where 20260929140000_tenant_booking_rules.sql has not been
  //    applied yet; a plain column reference would fail every call with 42703
  //    there. Once that migration is live everywhere, this can become a column.
  //  - slots of inactive resources are never offered, with or without a type
  //    filter (the resource subselect used to run only when a filter was
  //    given, so a deactivated bay/room kept being offered until its slots
  //    aged out).
  const rows = await sql<SlotRow>`
    with t as (
      select timezone,
        coalesce((to_jsonb(tn) ->> 'booking_min_notice_minutes')::int, ${noticeMinutes}::int) as notice
      from public.tenants tn where tn.id = ${ctx.tenantId}
    )
    select resource_id, lower(slot_range) as slot_start, upper(slot_range) as slot_end,
      (select timezone from t) as tz
    from public.availability_slots
    where tenant_id = ${ctx.tenantId}
      and is_available = true
      and slot_range && tstzrange(${range.start}, ${range.end})
      and (
        lower(slot_range) >= now() + make_interval(mins => (select notice from t))
        or (
          upper(slot_range) - lower(slot_range) >= interval '23 hours'
          and upper(slot_range) > now() + make_interval(mins => (select notice from t))
        )
      )
      and resource_id in (
        select id from public.resources
        where tenant_id = ${ctx.tenantId} and active
          and (${resourceType}::text is null or type = ${resourceType})
          and (
            ${roomType}::text is null
            or lower(room_type) = lower(${roomType})
            or not exists (
              select 1 from public.resources rt
              where rt.tenant_id = ${ctx.tenantId} and rt.active and rt.room_type is not null
            )
          )
          and (${partySize}::int is null or capacity >= ${partySize})
      )
    order by slot_start asc
    limit 20
  `;

  if (rows.length === 0) {
    // Nearest alternative: earliest open slot for this resource_type after
    // the requested window (bounded lookahead — a single extra indexed read,
    // not an unbounded scan).
    const alt = await sql<SlotRow>`
      with t as (
        select timezone,
          coalesce((to_jsonb(tn) ->> 'booking_min_notice_minutes')::int, ${noticeMinutes}::int) as notice
        from public.tenants tn where tn.id = ${ctx.tenantId}
      )
      select resource_id, lower(slot_range) as slot_start, upper(slot_range) as slot_end,
        (select timezone from t) as tz
      from public.availability_slots
      where tenant_id = ${ctx.tenantId}
        and is_available = true
        and lower(slot_range) >= ${range.end}
        and (
          lower(slot_range) >= now() + make_interval(mins => (select notice from t))
          or (
            upper(slot_range) - lower(slot_range) >= interval '23 hours'
            and upper(slot_range) > now() + make_interval(mins => (select notice from t))
          )
        )
        and resource_id in (
          select id from public.resources
          where tenant_id = ${ctx.tenantId} and active
            and (${resourceType}::text is null or type = ${resourceType})
            and (
            ${roomType}::text is null
            or lower(room_type) = lower(${roomType})
            or not exists (
              select 1 from public.resources rt
              where rt.tenant_id = ${ctx.tenantId} and rt.active and rt.room_type is not null
            )
          )
            and (${partySize}::int is null or capacity >= ${partySize})
        )
      order by slot_start asc
      limit 1
    `;
    const nearest = alt[0];
    return {
      slots: [],
      none_available: true,
      ...(nearest
        ? {
            nearest_alternative: {
              start: localIso(nearest.slot_start, nearest.tz),
              end: localIso(nearest.slot_end, nearest.tz),
            },
          }
        : {}),
    };
  }

  return {
    slots: rows.map((r) => ({
      start: localIso(r.slot_start, r.tz),
      end: localIso(r.slot_end, r.tz),
      resource_id: r.resource_id,
    })),
    none_available: false,
  };
}

function localIso(value: string | Date, tz: string | null | undefined): string {
  const rendered = toTenantLocalIso(value, tz);
  return typeof rendered === "string" ? rendered : String(rendered);
}
