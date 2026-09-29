/**
 * HOTPATH (docs/BUILD_NOTES.md): renders an instant as an ISO-8601 string in
 * the tenant's own timezone WITH its UTC offset, e.g.
 * `2026-09-29T10:00:00-04:00` for America/New_York.
 *
 * Why: `check_availability`/`create_booking` used to hand the model raw
 * `timestamptz` values, which postgres.js parses into `Date`s that serialize
 * as UTC (`2026-09-29T14:00:00.000Z`). The model then had to convert UTC to
 * the tenant's local time itself before speaking a slot, and live judged
 * runs show it getting that wrong (VERIFY-DEPLOY: "a UTC-vs-local slot
 * inconsistency"). The offset form is the SAME instant — Postgres parses it
 * back identically when the model passes it to `create_booking` — but the
 * wall-clock part is already what the caller should hear.
 *
 * `Intl.DateTimeFormat` with an IANA `timeZone` is available in both Deno and
 * Node, so this runs identically in the edge runtime and under Vitest.
 * Anything unusable (missing/invalid timezone, unparseable value) falls back
 * to the pre-HOTPATH behavior: the value's plain UTC ISO string, or the value
 * unchanged if it is not a date at all — never a throw on the hot path.
 */
export function toTenantLocalIso(value: unknown, timeZone: string | null | undefined): unknown {
  const date = toDate(value);
  if (!date) return value;
  if (!timeZone) return value instanceof Date ? date.toISOString() : value;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(date);
    const get = (type: Intl.DateTimeFormatPartTypes): string =>
      parts.find((p) => p.type === type)?.value ?? "00";
    const wall = `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
    // Offset = (the wall-clock reading interpreted as UTC) - (the instant),
    // at whole-second precision (the formatted wall clock has no ms).
    const wallAsUtcMs = Date.parse(`${wall}Z`);
    const instantMs = Math.floor(date.getTime() / 1000) * 1000;
    const offsetMinutes = Math.round((wallAsUtcMs - instantMs) / 60_000);
    return `${wall}${formatOffset(offsetMinutes)}`;
  } catch {
    // RangeError: invalid time zone — keep the pre-HOTPATH UTC shape.
    return value instanceof Date ? date.toISOString() : value;
  }
}

/**
 * VOICE-ALERTS-1: a short human time for an owner alert ("Thu, Oct 1, 2:00
 * PM") in the tenant's timezone, same wording as the `voice-events`
 * end-of-call booking alert. Never throws: falls back to the ISO string, or
 * "" for an unreadable value.
 */
export function formatLocalHuman(value: unknown, timeZone: string | null | undefined): string {
  const date = toDate(value);
  if (!date) return "";
  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: timeZone ?? "UTC",
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" && value.length > 0) {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : new Date(ms);
  }
  return null;
}

function formatOffset(totalMinutes: number): string {
  const sign = totalMinutes < 0 ? "-" : "+";
  const abs = Math.abs(totalMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${sign}${hh}:${mm}`;
}
