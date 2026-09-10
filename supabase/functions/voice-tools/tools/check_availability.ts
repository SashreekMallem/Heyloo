import type { z } from "zod";
import type { CheckAvailabilityArgsSchema } from "../../_shared/schemas/voice-tools.ts";
import type { SqlClient } from "../../_shared/types.ts";
import type { CallContext } from "../context.ts";

type Args = z.infer<typeof CheckAvailabilityArgsSchema>;

interface SlotRow {
  resource_id: string;
  slot_start: string;
  slot_end: string;
}

export interface CheckAvailabilityResult {
  slots: { start: string; end: string; resource_id: string }[];
  none_available: boolean;
  nearest_alternative?: { start: string; end: string };
}

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
 */
export async function checkAvailability(
  sql: SqlClient,
  ctx: CallContext,
  args: Args,
): Promise<CheckAvailabilityResult> {
  const resourceType = args.resource_type ?? null;
  const roomType = args.room_type ?? null;
  const partySize = args.party_size ?? null;

  const rows = await sql<SlotRow>`
    select resource_id, lower(slot_range) as slot_start, upper(slot_range) as slot_end
    from public.availability_slots
    where tenant_id = ${ctx.tenantId}
      and is_available = true
      and slot_range && tstzrange(${args.date_range.start}, ${args.date_range.end})
      and (
        (${resourceType}::text is null and ${roomType}::text is null and ${partySize}::int is null)
        or resource_id in (
          select id from public.resources
          where tenant_id = ${ctx.tenantId} and active
            and (${resourceType}::text is null or type = ${resourceType})
            and (${roomType}::text is null or room_type = ${roomType})
            and (${partySize}::int is null or capacity >= ${partySize})
        )
      )
    order by slot_start asc
    limit 20
  `;

  if (rows.length === 0) {
    // Nearest alternative: earliest open slot for this resource_type after
    // the requested window (bounded lookahead — a single extra indexed read,
    // not an unbounded scan).
    const alt = await sql<SlotRow>`
      select resource_id, lower(slot_range) as slot_start, upper(slot_range) as slot_end
      from public.availability_slots
      where tenant_id = ${ctx.tenantId}
        and is_available = true
        and lower(slot_range) >= ${args.date_range.end}
        and (
          (${resourceType}::text is null and ${roomType}::text is null and ${partySize}::int is null)
          or resource_id in (
            select id from public.resources
            where tenant_id = ${ctx.tenantId} and active
              and (${resourceType}::text is null or type = ${resourceType})
              and (${roomType}::text is null or room_type = ${roomType})
              and (${partySize}::int is null or capacity >= ${partySize})
          )
        )
      order by slot_start asc
      limit 1
    `;
    const nearest = alt[0];
    return {
      slots: [],
      none_available: true,
      ...(nearest
        ? { nearest_alternative: { start: nearest.slot_start, end: nearest.slot_end } }
        : {}),
    };
  }

  return {
    slots: rows.map((r) => ({ start: r.slot_start, end: r.slot_end, resource_id: r.resource_id })),
    none_available: false,
  };
}
