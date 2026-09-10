import type { Vertical } from "@heyloo/canonical-types";
import type { TenantRow } from "./database.types.js";

/**
 * Historical note (docs/audit/FIX_REQUESTS.md): this mapping used to
 * translate between `@heyloo/canonical-types`' `Vertical` short form
 * (`auto|vet|...`) and a long-form spelling (`auto_repair|veterinary`) that
 * a stale `docs/BUILD_NOTES.md` T5 entry claimed the live `tenants.vertical`
 * CHECK constraint used. The actual committed constraint
 * (`supabase/migrations/20260907130100_tenancy.sql`) has always been short
 * form only, matching `Vertical` exactly — confirmed by grepping every
 * consumer repo-wide (only `apps/web/src/app/api/checkout|signup/**`, and
 * the checkout route deliberately bypasses this mapping, passing the short
 * form straight through). `TenantRow["vertical"]` in `database.types.ts` was
 * fixed to the same short form alongside this change, so these are now
 * identity maps. Kept (rather than deleted) only so any external caller of
 * this exported name doesn't need to change — inline both at the call site
 * once no one imports them anymore.
 */
export const VERTICAL_TO_DB_VALUE: Record<Vertical, TenantRow["vertical"]> = {
  auto: "auto",
  vet: "vet",
  legal: "legal",
  dental: "dental",
  real_estate: "real_estate",
  motel: "motel",
  restaurant: "restaurant",
  generic: "generic",
};

export const DB_VALUE_TO_VERTICAL: Record<TenantRow["vertical"], Vertical> = {
  auto: "auto",
  vet: "vet",
  legal: "legal",
  dental: "dental",
  real_estate: "real_estate",
  motel: "motel",
  restaurant: "restaurant",
  generic: "generic",
};
