import { z } from "zod";
import {
  GOOGLE_FREEBUSY_MAX_ITEMS,
  GOOGLE_FREEBUSY_MAX_RANGE_DAYS,
  type GoogleBusyInterval,
} from "../providers/google-calendar.ts";

/**
 * CAL-1 canonical busy-time types and pure helpers, shared by the
 * worker-tick sync (`sync.ts`), the create_booking live re-check
 * (`live-check.ts`) and their callers. Nothing here carries a Google
 * payload shape: the provider (`_shared/providers/google-calendar.ts`)
 * returns `GoogleBusyInterval` lists keyed by calendar id, and this module
 * turns them into blocks that say which resource they block.
 */

const DAY_MS = 86_400_000;

/** One busy interval and what it blocks. `resourceId: null` = every resource. */
export interface CalendarBlock {
  calendarId: string;
  resourceId: string | null;
  /** UTC ISO instant, inclusive. */
  start: string;
  /** UTC ISO instant, exclusive. */
  end: string;
  /** True for the connection's own calendar, where the booking push writes
   * Heyloo's own bookings: those intervals are subtracted before storing. */
  subtractOwnBookings: boolean;
}

/** Which calendars one connection reads, and what each one blocks. */
export interface CalendarPlan {
  /** `adapter_connections.metadata.calendarId`, else `primary`. Blocks every resource. */
  connectionCalendarId: string;
  /** Calendars mapped to one resource each
   * (`resources.metadata.adapter_external_id.google_calendar`). */
  resourceCalendars: { resourceId: string; calendarId: string }[];
}

export const DEFAULT_CALENDAR_ID = "primary";

const zCalendarId = z.string().trim().min(1).max(1024);
/** Shape-only uuid check (a real `resources.id`); never binds a non-uuid. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const zResourceCalendarRow = z.object({
  resource_id: z.string().regex(UUID_RE),
  calendar_id: zCalendarId,
});

/**
 * Builds the plan from the connection's `metadata` and the tenant's mapped
 * resources (`[{resource_id, calendar_id}]`, read in the same statement as
 * the connection). Malformed entries are dropped, never trusted; a resource
 * mapped to the connection's own calendar adds nothing (that calendar already
 * blocks every resource); the total stays within one freeBusy request.
 */
export function buildCalendarPlan(metadata: unknown, resourceCalendars: unknown): CalendarPlan {
  const meta =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {};
  const configured = zCalendarId.safeParse(meta["calendarId"]);
  const connectionCalendarId = configured.success ? configured.data : DEFAULT_CALENDAR_ID;

  const mapped: CalendarPlan["resourceCalendars"] = [];
  const calendars = new Set([connectionCalendarId]);
  for (const raw of Array.isArray(resourceCalendars) ? resourceCalendars : []) {
    const row = zResourceCalendarRow.safeParse(raw);
    if (!row.success || row.data.calendar_id === connectionCalendarId) continue;
    if (!calendars.has(row.data.calendar_id) && calendars.size >= GOOGLE_FREEBUSY_MAX_ITEMS) {
      continue;
    }
    calendars.add(row.data.calendar_id);
    mapped.push({ resourceId: row.data.resource_id, calendarId: row.data.calendar_id });
  }
  return { connectionCalendarId, resourceCalendars: mapped };
}

/** The distinct calendar ids one freeBusy request asks for. */
export function planCalendarIds(plan: CalendarPlan): string[] {
  return [
    ...new Set([plan.connectionCalendarId, ...plan.resourceCalendars.map((r) => r.calendarId)]),
  ];
}

/** Turns per-calendar busy intervals into blocks (one per interval per
 * resource it blocks). A calendar absent from `calendars` contributes
 * nothing; the provider already fails the whole read when one is missing. */
export function blocksFromBusy(
  plan: CalendarPlan,
  calendars: Readonly<Record<string, readonly GoogleBusyInterval[]>>,
): CalendarBlock[] {
  const blocks: CalendarBlock[] = [];
  for (const interval of calendars[plan.connectionCalendarId] ?? []) {
    blocks.push({
      calendarId: plan.connectionCalendarId,
      resourceId: null,
      start: interval.start,
      end: interval.end,
      subtractOwnBookings: true,
    });
  }
  for (const mapping of plan.resourceCalendars) {
    for (const interval of calendars[mapping.calendarId] ?? []) {
      blocks.push({
        calendarId: mapping.calendarId,
        resourceId: mapping.resourceId,
        start: interval.start,
        end: interval.end,
        subtractOwnBookings: false,
      });
    }
  }
  return blocks;
}

/** Splits `[startMs, endMs)` into consecutive windows of at most `maxDays`. */
export function chunkTimeRange(
  startMs: number,
  endMs: number,
  maxDays: number = GOOGLE_FREEBUSY_MAX_RANGE_DAYS,
): { timeMin: string; timeMax: string }[] {
  const step = Math.max(1, maxDays) * DAY_MS;
  const chunks: { timeMin: string; timeMax: string }[] = [];
  for (let from = startMs; from < endMs; from += step) {
    const to = Math.min(from + step, endMs);
    chunks.push({ timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString() });
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Live re-check (create_booking)
// ---------------------------------------------------------------------------

/**
 * What the live calendar check answered:
 * - `skipped`: the tenant has no connected calendar (nothing to check);
 * - `unknown`: there is one, but it could not be read in time (timeout,
 *   expired token, Google error) — the booking proceeds on the synced table;
 * - `checked`: the calendar's busy blocks inside the requested window.
 */
export type LiveBusyVerdict =
  | { status: "skipped" }
  | { status: "unknown"; reason: string }
  | { status: "checked"; blocks: CalendarBlock[] };

/** The create_booking dependency: the tenant's live busy blocks for
 * `[range.start, range.end)`, settling `unknown` when `signal` aborts. */
export type CalendarBusyCheck = (
  tenantId: string,
  range: { start: string; end: string },
  signal: AbortSignal,
) => Promise<LiveBusyVerdict>;

export interface InstantRange {
  start: string | Date;
  end: string | Date;
}

function ms(value: string | Date): number {
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

/** True when some part of `[window.start, window.end)` inside `busy` is not
 * covered by `exclude` (all half-open). */
function windowStillBusy(
  window: { start: number; end: number },
  busy: { start: number; end: number },
  exclude: readonly { start: number; end: number }[],
): boolean {
  let from = Math.max(window.start, busy.start);
  const to = Math.min(window.end, busy.end);
  if (from >= to) return false;
  const covering = exclude
    .filter((e) => e.end > from && e.start < to)
    .sort((a, b) => a.start - b.start);
  for (const e of covering) {
    if (e.start > from) return true; // an uncovered gap before this exclusion
    from = Math.max(from, e.end);
    if (from >= to) return false;
  }
  return from < to;
}

/**
 * Decides the live check for the resource the booking landed on: `busy`
 * when a block that applies to it (`resourceId` null or equal) still overlaps
 * the window after Heyloo's own pushed bookings (`ownBookings`, the tenant's
 * Google-pushed bookings around the window) are taken out of the
 * connection-calendar blocks.
 */
export function liveVerdictForResource(
  verdict: LiveBusyVerdict,
  resourceId: string,
  window: InstantRange,
  ownBookings: readonly InstantRange[],
): "busy" | "free" | "unknown" | "skipped" {
  if (verdict.status !== "checked") return verdict.status;
  const win = { start: ms(window.start), end: ms(window.end) };
  if (!Number.isFinite(win.start) || !Number.isFinite(win.end)) return "unknown";
  const own = ownBookings
    .map((b) => ({ start: ms(b.start), end: ms(b.end) }))
    .filter((b) => Number.isFinite(b.start) && Number.isFinite(b.end) && b.start < b.end);
  for (const block of verdict.blocks) {
    if (block.resourceId !== null && block.resourceId !== resourceId) continue;
    const busy = { start: ms(block.start), end: ms(block.end) };
    if (!Number.isFinite(busy.start) || !Number.isFinite(busy.end)) continue;
    if (windowStillBusy(win, busy, block.subtractOwnBookings ? own : [])) return "busy";
  }
  return "free";
}
