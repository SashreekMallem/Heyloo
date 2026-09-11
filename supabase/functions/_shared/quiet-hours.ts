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

const DEFAULT_START_HOUR = 21;
const DEFAULT_END_HOUR = 9;

export interface QuietHoursWindow {
  enabled: boolean;
  startHour: number;
  endHour: number;
}

function parseHour(hhmm: unknown): number | null {
  if (typeof hhmm !== "string") return null;
  const match = /^(\d{1,2}):\d{2}$/.exec(hhmm.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : null;
}

/**
 * Resolves a tenant's `tenants.quiet_hours` jsonb column
 * (`{"start":"21:00","end":"09:00","enabled":true}`, BACKEND_SPEC.md §13.2)
 * into the `{enabled, startHour, endHour}` shape `isQuietHours` takes.
 * Unset/unconfigured (`{}`, the column default) or malformed fields fall
 * back to the MASTER_SPEC §3.6 default (9pm-9am, enabled) rather than
 * disabling quiet-hours gating outright — a tenant must explicitly set
 * `enabled: false` to opt all the way out. Used for PROACTIVE/unsolicited
 * outbound only (booking reminders, campaigns) — a text-agent reply to a
 * customer-initiated conversation is never gated by this at all (TCPA:
 * replying inside an exchange the customer started is not "unsolicited"),
 * per the CHANNELS-2 ratified decision.
 */
export function resolveQuietHoursWindow(raw: unknown): QuietHoursWindow {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const enabled = obj["enabled"] !== false;
  const startHour = parseHour(obj["start"]) ?? DEFAULT_START_HOUR;
  const endHour = parseHour(obj["end"]) ?? DEFAULT_END_HOUR;
  return { enabled, startHour, endHour };
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
