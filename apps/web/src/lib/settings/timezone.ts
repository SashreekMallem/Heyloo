/**
 * SETTINGS-1: `tenants.timezone` drives every slot the AI offers
 * (`fn_regenerate_availability_slots` builds local times `at time zone`
 * it), the date/weekday variables the AI speaks, and reminder quiet hours.
 * The value must be an IANA zone name both `Intl` and Postgres understand.
 */

/** The zones most US/CA owners need, in the order a picker should show them. */
export const COMMON_TIMEZONES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "America/New_York", label: "Eastern (New York)" },
  { value: "America/Chicago", label: "Central (Chicago)" },
  { value: "America/Denver", label: "Mountain (Denver)" },
  { value: "America/Phoenix", label: "Mountain, no DST (Phoenix)" },
  { value: "America/Los_Angeles", label: "Pacific (Los Angeles)" },
  { value: "America/Anchorage", label: "Alaska (Anchorage)" },
  { value: "Pacific/Honolulu", label: "Hawaii (Honolulu)" },
  { value: "America/Halifax", label: "Atlantic (Halifax)" },
  { value: "America/St_Johns", label: "Newfoundland (St. John's)" },
  { value: "America/Puerto_Rico", label: "Atlantic, no DST (Puerto Rico)" },
];

const IANA_SEGMENT = /^[A-Za-z0-9_+-]+$/;

/** "Area/Location[/Sub]" of plain ASCII segments — checked per segment (no nested-quantifier regex). */
function looksLikeIanaName(value: string): boolean {
  if (value.length === 0 || value.length > 64 || !/^[A-Za-z]/.test(value)) return false;
  const segments = value.split("/");
  return segments.length <= 3 && segments.every((segment) => IANA_SEGMENT.test(segment));
}

export function isValidTimezone(value: string): boolean {
  if (!looksLikeIanaName(value)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Every zone this runtime knows, common ones first (falls back to the common list on old runtimes). */
export function allTimezones(): string[] {
  const common = COMMON_TIMEZONES.map((z) => z.value);
  let all: string[] = [];
  try {
    all = Intl.supportedValuesOf("timeZone");
  } catch {
    all = [];
  }
  const rest = all.filter((zone) => !common.includes(zone));
  return [...common, ...rest];
}

/** "3:05 PM" in the given zone — shown next to the picker so the owner can sanity-check it. */
export function currentTimeIn(timezone: string, now: Date = new Date()): string | null {
  if (!isValidTimezone(timezone)) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    weekday: "short",
  }).format(now);
}
