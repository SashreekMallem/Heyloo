/**
 * HOTPATH-REVIEW (docs/BUILD_NOTES.md): the one place a model-supplied time
 * range is parsed before any tool binds it into SQL.
 *
 * postgres.js does not send a timestamp parameter as the text the model
 * wrote. For the date types (OIDs 1082/1114/1184) it sends
 * `new Date(value).toISOString()` (postgres@3.4.9 `src/types.js`,
 * `date.serialize`). So the instant Postgres stores is JavaScript's reading
 * of the string. Parsing it here the same way gives three things:
 *
 *  1. An unparseable value is answered as `invalid_time` with an
 *     instruction, before any SQL runs. The stock serializer would throw
 *     inside the client instead, and on the hot path's single connection
 *     that can poison the connection for the whole isolate
 *     (`_shared/db-options.ts#serializeTimestampParam`).
 *  2. Callers bind the normalized ISO string, which is exactly what the
 *     serializer would have produced, so nothing about what is stored
 *     changes.
 *  3. The same instant written two ways (`2026-09-29T10:00:00-04:00` from
 *     check_availability, `2026-09-29T14:00:00.000Z` on a retry) has one
 *     normalized form, which is what the booking idempotency key needs.
 */

/**
 * F1 / F-VET-AVAIL-1: the only offset-less shapes the tools resolve against
 * the tenant's timezone — the ISO date or date-time the tool descriptions ask
 * for (`2026-09-30T09:00:00`, `2026-09-30 09:00`, `2026-09-30`). Anything with
 * a `Z` or `+hh:mm` offset is already an instant, and anything else stays
 * with JavaScript's own reading (see `normalizeInstant`).
 */
const NAIVE_ISO_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?)?$/;

/** True when `value` is an ISO date/date-time with no UTC offset. */
export function isNaiveTimeString(value: string): boolean {
  return NAIVE_ISO_RE.test(value.trim());
}

/** UTC offset (ms, positive east of UTC) of `timeZone` at `instantMs`. */
function zoneOffsetMs(instantMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instantMs));
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  const wallAsUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return wallAsUtc - Math.floor(instantMs / 1000) * 1000;
}

/** The instant (ms) at which `timeZone`'s wall clock reads `wallAsUtcMs`
 * (the wall clock written as if it were UTC). Two passes settle the offset
 * across a DST change; a wall time inside a spring-forward gap resolves to
 * the instant just after the gap. Throws RangeError for an unknown zone. */
function wallToInstantMs(wallAsUtcMs: number, timeZone: string): number {
  const first = wallAsUtcMs - zoneOffsetMs(wallAsUtcMs, timeZone);
  return wallAsUtcMs - zoneOffsetMs(first, timeZone);
}

/**
 * `value` as the ISO-8601 UTC string postgres.js would bind, or `null` if
 * JavaScript cannot parse it. Never throws.
 *
 * `timeZone` (the tenant's IANA zone): an offset-less ISO date-time is the
 * caller's wall clock in that zone, NOT the server's (UTC in the edge
 * runtime — `2026-09-30T09:00:00` used to mean 04:00 in Chicago and produced
 * false "no openings"); a date-only string is local midnight. Without a zone
 * the legacy reading (`Date.parse`) applies.
 */
export function normalizeInstant(value: string, timeZone?: string | null): string | null {
  if (timeZone) {
    const m = NAIVE_ISO_RE.exec(value.trim());
    if (m) {
      const wallAsUtc = Date.UTC(
        Number(m[1]),
        Number(m[2]) - 1,
        Number(m[3]),
        Number(m[4] ?? "0"),
        Number(m[5] ?? "0"),
        Number(m[6] ?? "0"),
        Number((m[7] ?? "0").padEnd(3, "0")),
      );
      if (!Number.isNaN(wallAsUtc)) {
        try {
          return new Date(wallToInstantMs(wallAsUtc, timeZone)).toISOString();
        } catch {
          // Unknown zone: fall through to the legacy reading.
        }
      }
    }
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** A model-supplied `[start, end)` normalized, or `null` if either end is
 * unparseable or the range runs backwards (`tstzrange` raises 22000 for
 * that). An empty range (`end == start`) is also `null` unless
 * `allowEmpty`: a zero-length booking would never collide with anything in
 * the exclusion constraint, so it must never be written, while
 * check_availability has always answered an empty window (e.g. the same
 * date-only string twice) with "none, nearest alternative ..." and keeps
 * doing so. */
export function normalizeTimeRange(
  start: string,
  end: string,
  opts: { allowEmpty?: boolean; timeZone?: string | null } = {},
): { start: string; end: string } | null {
  const s = normalizeInstant(start, opts.timeZone);
  const e = normalizeInstant(end, opts.timeZone);
  if (s === null || e === null) return null;
  const startMs = Date.parse(s);
  const endMs = Date.parse(e);
  if (endMs < startMs || (endMs === startMs && !opts.allowEmpty)) return null;
  return { start: s, end: e };
}

/**
 * F1: rewrites every offset-less time in `values` to the UTC instant it means
 * in the tenant's timezone, so every tool downstream sees an unambiguous
 * instant. One indexed `tenants` read, and only when at least one value is
 * offset-less (the model normally sends an offset, so the common path pays
 * nothing). A failed read leaves the values untouched (legacy reading) and is
 * reported through `onError`; it never fails the tool.
 */
export async function localizeNaiveTimes<T extends Record<string, string | undefined>>(
  readTimeZone: () => Promise<string | null | undefined>,
  values: T,
  onError?: (err: unknown) => void,
): Promise<T> {
  const keys = Object.keys(values).filter((k) => {
    const v = values[k];
    return typeof v === "string" && isNaiveTimeString(v);
  });
  if (keys.length === 0) return values;
  let timeZone: string | null | undefined;
  try {
    timeZone = await readTimeZone();
  } catch (err) {
    onError?.(err);
    return values;
  }
  if (!timeZone) return values;
  const out: Record<string, string | undefined> = { ...values };
  for (const k of keys) {
    const v = values[k];
    if (typeof v !== "string") continue;
    out[k] = normalizeInstant(v, timeZone) ?? v;
  }
  return out as T;
}
