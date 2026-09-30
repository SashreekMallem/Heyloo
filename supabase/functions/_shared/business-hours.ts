/**
 * Precomputes the `greeting_hours_context` dynamic variable
 * (BACKEND_SPEC §7.1: 'precomputed "we're open until 6pm" / "we're closed"
 * string') from `tenants.business_hours`/`hours_exceptions` + IANA
 * timezone (SYSTEM_DESIGN §5: "timezone math baked in at materialization,
 * never in the hot path" — this runs once per inbound call, not per turn,
 * and is pure/sync so it adds no I/O to the `/voice-inbound` budget).
 */

export interface HoursWindow {
  open: string; // "HH:MM", 24h, tenant-local
  close: string;
}

export type WeeklyBusinessHours = Partial<
  Record<"sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat", HoursWindow[]>
>;

export interface HoursException {
  date: string; // "YYYY-MM-DD", tenant-local
  closed?: boolean;
  hours?: HoursWindow[];
}

const DOW_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

function localParts(
  date: Date,
  timeZone: string,
): { dow: (typeof DOW_KEYS)[number]; dateStr: string; minutes: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekdayShort = get("weekday").toLowerCase().slice(0, 3);
  const dow = (DOW_KEYS as readonly string[]).includes(weekdayShort)
    ? (weekdayShort as (typeof DOW_KEYS)[number])
    : "sun";
  const dateStr = `${get("year")}-${get("month")}-${get("day")}`;
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  return { dow, dateStr, minutes: hour * 60 + minute };
}

function timeStrToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function formatMinutesAs12h(totalMinutes: number): string {
  const h24 = Math.floor(totalMinutes / 60) % 24;
  const m = totalMinutes % 60;
  const period = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h12} ${period}` : `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

/**
 * CALL-2 (docs/BUILD_NOTES.md): the model's absolute-date anchor
 * (`current_date`/`current_weekday` dynamic variables, `CURRENT_DATE_
 * FRAGMENT`) — confirmed live that without one, the model resolves
 * relative dates ("tomorrow") against its own training-era sense of
 * "today" rather than the real date, producing `check_availability`
 * `date_range` values years off from the real generated window. Reuses
 * the same `Intl.DateTimeFormat` tenant-timezone-local-date approach
 * `computeGreetingHoursContext`'s own `localParts` helper already uses
 * (kept as a small separate function rather than exporting/reshaping that
 * one, since its `dow` is a 3-letter key for business-hours lookups, not a
 * full spoken weekday name).
 */
export function computeCurrentDateContext(
  now: Date,
  timeZone: string,
): { date: string; weekday: string } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    weekday: get("weekday"),
  };
}

/**
 * CALL-6 (docs/BUILD_NOTES.md — OPS-5's own `wrong_date_caller` finding,
 * "the model re-dates the caller's corrected date without asking"):
 * `current_date`/`current_weekday` alone still leaves the model to do
 * weekday-name-to-calendar-date arithmetic ("next Monday") itself —
 * confirmed live that it gets this wrong even when told the anchor date
 * (e.g. computing "next Monday" from a Sunday anchor as 11 days out and
 * not even landing on an actual Monday). Same fix pattern as `current_
 * date` itself (SYSTEM_DESIGN §5: "timezone math baked in at
 * materialization, never in the hot path", and never left for the model
 * to compute): precomputes the next 7 calendar days' weekday->date
 * mapping, tenant-timezone-local, as a single compact lookup string the
 * prompt can hand the model instead of asking it to count days — e.g.
 * `"Monday=2026-09-21, Tuesday=2026-09-22, ..., Sunday=2026-09-27"`
 * (starting tomorrow, so "today" — already covered by `current_date`/
 * `current_weekday` — is never duplicated in it).
 */
export function computeUpcomingWeekdayDates(now: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const entries: string[] = [];
  for (let offset = 1; offset <= 7; offset++) {
    const day = new Date(now.getTime() + offset * 24 * 60 * 60 * 1000);
    const parts = formatter.formatToParts(day);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    entries.push(`${get("weekday")}=${get("year")}-${get("month")}-${get("day")}`);
  }
  return entries.join(", ");
}

/**
 * SETTINGS-2 (docs/BUILD_NOTES.md): is the business open at `now`? Same
 * window/exception resolution as `computeGreetingHoursContext` (an exception
 * with `closed: true` closes the day; an exception's own `hours` replace the
 * weekly ones; a `[]` weekday is closed) — used by `agent-settings.ts` to
 * decide, at call time, which transfer number (if any) the call may use.
 * A business with NO hours configured at all is treated as always open, so
 * "only during business hours" never silently turns transfers off for a
 * tenant that never entered hours.
 */
export function isOpenAt(
  now: Date,
  timeZone: string,
  businessHours: WeeklyBusinessHours,
  exceptions: HoursException[] = [],
): boolean {
  const configured = DOW_KEYS.some((key) => (businessHours[key] ?? []).length > 0);
  const { dow, dateStr, minutes } = localParts(now, timeZone);
  const exception = exceptions.find((e) => e.date === dateStr);
  if (!configured && !exception) return true;
  let windows: HoursWindow[];
  if (exception?.closed) windows = [];
  else if (exception?.hours) windows = exception.hours;
  else windows = businessHours[dow] ?? [];
  // A window closing at 23:59 is how an all-day ("open 24 hours") day is stored: it stays open
  // through the last minute instead of flipping to "closed" for 23:59.
  return windows.some((window) => {
    const closeMin = timeStrToMinutes(window.close);
    return (
      minutes >= timeStrToMinutes(window.open) && minutes < (closeMin >= 1439 ? 1440 : closeMin)
    );
  });
}

export function computeGreetingHoursContext(
  now: Date,
  timeZone: string,
  businessHours: WeeklyBusinessHours,
  exceptions: HoursException[] = [],
): string {
  const { dow, dateStr, minutes } = localParts(now, timeZone);
  const exception = exceptions.find((e) => e.date === dateStr);

  let windows: HoursWindow[];
  if (exception?.closed) {
    windows = [];
  } else if (exception?.hours) {
    windows = exception.hours;
  } else {
    windows = businessHours[dow] ?? [];
  }

  if (windows.length === 0) {
    return "We're closed today.";
  }

  const sorted = [...windows].sort((a, b) => timeStrToMinutes(a.open) - timeStrToMinutes(b.open));

  for (const window of sorted) {
    const openMin = timeStrToMinutes(window.open);
    const closeMin = timeStrToMinutes(window.close);
    if (minutes >= openMin && minutes < closeMin) {
      return `We're open until ${formatMinutesAs12h(closeMin)}.`;
    }
    if (minutes < openMin) {
      return `We're currently closed, opening today at ${formatMinutesAs12h(openMin)}.`;
    }
  }

  return "We're closed for the day.";
}

const DAY_LABELS: Record<(typeof DOW_KEYS)[number], string> = {
  sun: "Sun",
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
};
/** Monday-first display order. */
const DISPLAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

function formatWindows(windows: HoursWindow[]): string {
  if (windows.length === 0) return "closed";
  const sorted = [...windows].sort((a, b) => timeStrToMinutes(a.open) - timeStrToMinutes(b.open));
  // A single 00:00-23:59 window is how "open 24 hours" is stored.
  if (
    sorted.length === 1 &&
    timeStrToMinutes(sorted[0]?.open ?? "") === 0 &&
    timeStrToMinutes(sorted[0]?.close ?? "") >= 1439
  ) {
    return "open 24 hours";
  }
  return sorted
    .map((w) => {
      const close = timeStrToMinutes(w.close);
      return `${formatMinutesAs12h(timeStrToMinutes(w.open))}-${
        close >= 1439 ? "midnight" : formatMinutesAs12h(close)
      }`;
    })
    .join(" and ");
}

/**
 * F-HOURS-1 / F6 / VCC-3: the weekly opening hours and upcoming exceptions as
 * one sentence for the agent, e.g. `Mon-Thu 8 AM-5 PM, Fri 8 AM-2 PM, Sat-Sun
 * closed. Exceptions: closed 2026-11-26.` Consecutive days with identical hours
 * are grouped. `""` when the tenant has entered no hours at all (never guessed).
 * Only exceptions from today on, within `EXCEPTION_HORIZON_DAYS`, are listed.
 */
const EXCEPTION_HORIZON_DAYS = 90;

export function formatBusinessHoursText(
  now: Date,
  timeZone: string,
  businessHours: WeeklyBusinessHours,
  exceptions: HoursException[] = [],
): string {
  const configured = DOW_KEYS.some((key) => (businessHours[key] ?? []).length > 0);
  if (!configured) return "";
  const groups: { days: (typeof DOW_KEYS)[number][]; text: string }[] = [];
  for (const day of DISPLAY_ORDER) {
    const text = formatWindows(businessHours[day] ?? []);
    const last = groups[groups.length - 1];
    if (last && last.text === text) last.days.push(day);
    else groups.push({ days: [day], text });
  }
  const weekly = groups
    .map((g) => {
      const first = g.days[0];
      const end = g.days[g.days.length - 1];
      const label =
        first && end && first !== end
          ? `${DAY_LABELS[first]}-${DAY_LABELS[end]}`
          : first
            ? DAY_LABELS[first]
            : "";
      return `${label} ${g.text}`;
    })
    .join(", ");

  const { dateStr: today } = localParts(now, timeZone);
  const horizon = localParts(
    new Date(now.getTime() + EXCEPTION_HORIZON_DAYS * 86_400_000),
    timeZone,
  ).dateStr;
  const upcoming = exceptions
    .filter((e) => typeof e.date === "string" && e.date >= today && e.date <= horizon)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 12)
    .map((e) => {
      const label = (e as { label?: unknown }).label;
      const suffix =
        typeof label === "string" && label.trim() ? ` (${label.trim().slice(0, 40)})` : "";
      if (e.closed || !e.hours || e.hours.length === 0) return `closed ${e.date}${suffix}`;
      return `${e.date}${suffix} ${formatWindows(e.hours)}`;
    });
  return upcoming.length > 0 ? `${weekly}. Exceptions: ${upcoming.join("; ")}.` : `${weekly}.`;
}
