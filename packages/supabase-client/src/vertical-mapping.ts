import type { Vertical } from "@heyloo/canonical-types";
import type { TenantRow } from "./database.types.js";

/**
 * `packages/canonical-types`' `Vertical` enum (T2:
 * `auto|vet|legal|dental|real_estate|motel|restaurant|generic`) and
 * `tenants.vertical`'s DB check constraint (T1:
 * `auto_repair|veterinary|legal|dental|real_estate|motel|restaurant|generic`)
 * were built by different tasks against the same spec and landed with two
 * different spellings for the same two verticals (auto/auto_repair,
 * vet/veterinary). Documented in docs/BUILD_NOTES.md T5 entry rather than
 * silently reconciled in either package (CLAUDE.md Rule 4 — flag, don't
 * redesign someone else's committed schema). This mapping is the single
 * place apps/web converts between the two; nowhere else should hardcode
 * either spelling against the other.
 */
export const VERTICAL_TO_DB_VALUE: Record<Vertical, TenantRow["vertical"]> = {
  auto: "auto_repair",
  vet: "veterinary",
  legal: "legal",
  dental: "dental",
  real_estate: "real_estate",
  motel: "motel",
  restaurant: "restaurant",
  generic: "generic",
};

export const DB_VALUE_TO_VERTICAL: Record<TenantRow["vertical"], Vertical> = {
  auto_repair: "auto",
  veterinary: "vet",
  legal: "legal",
  dental: "dental",
  real_estate: "real_estate",
  motel: "motel",
  restaurant: "restaurant",
  generic: "generic",
};
