/**
 * Parses a Postgres `tstzrange`'s default text wire format —
 * `["2026-09-08 09:00:00+00","2026-09-08 09:30:00+00")` — into ISO-8601
 * bounds. `apps/web` reads `availability_slots` through PostgREST
 * (`@supabase/supabase-js`), which has no `lower()`/`upper()` range-function
 * projection the way the Deno edge functions' direct Postgres connection
 * does (`voice-tools/tools/check_availability.ts`); this is the shared
 * client + server equivalent (FRONTEND_SPEC.md §6.4 reschedule slot-picker,
 * `api/tenant/bookings/[id]/route.ts`). Confirmed format matches
 * `packages/supabase-client/src/database.types.ts`'s
 * `AvailabilitySlotRow.slot_range` doc comment.
 */
export function parseTstzrange(raw: string): { start: string; end: string } | null {
  const match = raw.match(/^[[(]"?([^",]+)"?,"?([^",]+)"?[\])]$/);
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (!rawStart || !rawEnd) return null;
  const toIso = (s: string) => {
    const isoish = s.trim().replace(" ", "T");
    return /[+-]\d{2}$/.test(isoish) ? `${isoish}:00` : isoish;
  };
  return { start: toIso(rawStart), end: toIso(rawEnd) };
}
