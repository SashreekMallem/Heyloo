import type { SupabaseServerClient } from "@heyloo/supabase-client";

/**
 * SETTINGS-1 review (docs/BUILD_NOTES.md): `isValidTimezone` asks the
 * Node/browser ICU time-zone database, which can be NEWER than Postgres's.
 * Live on 2026-09-29, `America/Coyhaique` (tzdata 2025b) was in
 * `Intl.supportedValuesOf("timeZone")` — so it appeared in the Business
 * tab's "Show all time zones" list and passed validation — but not in the
 * project's `pg_timezone_names`. A zone Postgres can't resolve makes
 * `fn_regenerate_availability_slots` raise 22023 ("time zone ... not
 * recognized"), and `fn_cron_availability_rollforward` regenerates EVERY
 * tenant's resources in one transaction with no exception handler, so one
 * tenant saving such a zone would abort the nightly slot roll-forward for
 * every tenant.
 *
 * So before a zone is stored, ask Postgres itself: a `timestamptz` literal
 * carrying the zone name is resolved by the same tz lookup `AT TIME ZONE`
 * uses (checked live: all 417 zones both sides know parse; the ICU-only
 * one fails with 22023). The probe is a read of the caller's own tenant
 * row under their RLS session — no new database object needed.
 */
export type DatabaseTimezoneCheck = "known" | "unknown" | "error";

/** Postgres errors that mean "that zone/literal isn't valid", not an outage. */
const INVALID_VALUE_CODES = new Set(["22023", "22007", "22008", "22P02"]);

export async function checkTimezoneKnownToDatabase(
  supabase: SupabaseServerClient,
  tenantId: string,
  timezone: string,
): Promise<DatabaseTimezoneCheck> {
  const { error } = await supabase
    .from("tenants")
    .select("id")
    .eq("id", tenantId)
    .lte("created_at", `2999-12-31 00:00:00 ${timezone}`)
    .limit(1);
  if (!error) return "known";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && INVALID_VALUE_CODES.has(code) ? "unknown" : "error";
}

/** Shown inline under the Business tab's picker when Postgres doesn't know the zone yet. */
export const TIMEZONE_NOT_SUPPORTED_MESSAGE =
  "This time zone isn't supported yet — pick a nearby city that shares your local time.";
