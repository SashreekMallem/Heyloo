/**
 * Tenant-local quiet-hours check for outbound reminders (MASTER_SPEC §3.6:
 * "quiet hours 9pm-9am tenant-local enforced"). Uses the standard `Intl`
 * API (native in Deno + Node, no timezone-data dependency) to resolve the
 * wall-clock hour in the tenant's IANA timezone.
 */

export function isQuietHours(
  date: Date,
  timeZone: string,
  quietStartHour = 21,
  quietEndHour = 9,
): boolean {
  const hour = localHour(date, timeZone);
  if (quietStartHour > quietEndHour) {
    // Wraps midnight, e.g. 21 -> 9.
    return hour >= quietStartHour || hour < quietEndHour;
  }
  return hour >= quietStartHour && hour < quietEndHour;
}

export function localHour(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const hourPart = parts.find((p) => p.type === "hour")?.value ?? "0";
  // Intl can render midnight as "24" with hourCycle h23/h24 quirks depending
  // on runtime ICU data; normalize into [0,23].
  return Number(hourPart) % 24;
}

/** Next local time the quiet-hours window ends (for scheduling a deferred
 * send rather than dropping the reminder). Returns a Date in the same
 * absolute instant space, computed by walking forward hour-by-hour — bounded
 * loop, never runs past 24 iterations. */
export function nextQuietHoursEnd(date: Date, timeZone: string, quietEndHour = 9): Date {
  const candidate = new Date(date);
  for (let i = 0; i < 24; i++) {
    if (localHour(candidate, timeZone) === quietEndHour) return candidate;
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 60);
  }
  return candidate;
}
