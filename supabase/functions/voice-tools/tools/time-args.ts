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

/** `value` as the ISO-8601 UTC string postgres.js would bind, or `null` if
 * JavaScript cannot parse it. Never throws. */
export function normalizeInstant(value: string): string | null {
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
  opts: { allowEmpty?: boolean } = {},
): { start: string; end: string } | null {
  const s = normalizeInstant(start);
  const e = normalizeInstant(end);
  if (s === null || e === null) return null;
  const startMs = Date.parse(s);
  const endMs = Date.parse(e);
  if (endMs < startMs || (endMs === startMs && !opts.allowEmpty)) return null;
  return { start: s, end: e };
}
