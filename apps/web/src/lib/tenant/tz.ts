/**
 * Tenant-local time helpers shared by the tenant portal pages (QA-1
 * portal-core). Dependency-free so they are trivially unit-tested.
 */

const DEFAULT_TZ = "UTC";

function safeTz(tz: string | null | undefined): string {
  if (!tz) return DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TZ;
  }
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function localParts(instant: Date, tz: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

/** `YYYY-MM-DD` of `instant` in the tenant's own timezone (never the UTC date). */
export function tenantDateKey(tz: string | null | undefined, instant: Date = new Date()): string {
  const p = localParts(instant, safeTz(tz));
  return `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Milliseconds `tz` is ahead of UTC at `instant`. */
function tzOffsetMs(instant: Date, tz: string): number {
  const p = localParts(instant, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * ISO instant of local midnight (00:00) of `dateKey` (`YYYY-MM-DD`) in `tz`.
 * DST-safe: re-derives the offset at the candidate instant once.
 */
export function tenantMidnightIso(tz: string | null | undefined, dateKey: string): string {
  const zone = safeTz(tz);
  const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
  const wall = Date.UTC(y, m - 1, d, 0, 0, 0);
  const first = wall - tzOffsetMs(new Date(wall), zone);
  const second = wall - tzOffsetMs(new Date(first), zone);
  return new Date(second).toISOString();
}

/** ISO instant at which the tenant-local day containing `instant` began. */
export function tenantDayStartIso(
  tz: string | null | undefined,
  instant: Date = new Date(),
): string {
  return tenantMidnightIso(tz, tenantDateKey(tz, instant));
}

/** `YYYY-MM-DD` of the tenant-local day `days` before today's (0 = today). */
export function tenantDateKeyDaysAgo(
  tz: string | null | undefined,
  days: number,
  instant: Date = new Date(),
): string {
  const [y, m, d] = tenantDateKey(tz, instant).split("-").map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(y, m - 1, d - days));
  return shifted.toISOString().slice(0, 10);
}
