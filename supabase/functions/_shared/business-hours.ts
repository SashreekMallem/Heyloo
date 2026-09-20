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
