import { loadDeliverySettings, resolveBusinessLocation } from "../_shared/delivery-distance.ts";
import type { CensusFetch } from "../_shared/providers/census-geocode.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";

/**
 * `/api-tenant-business-location` (DELIVERY-1, docs/BUILD_NOTES.md): the
 * portal calls this right after an owner saves a changed business address
 * (Agent -> Business), so the owner sees at once whether the address was
 * found ("Located: <matched address>") instead of the first delivery call
 * finding out. Geocodes the tenant's CURRENT business address (forced, even
 * when a cached result exists) and stores the location on the tenant row
 * (`tenants.business_lat/lng/...`, system-only columns written here with the
 * secret key). The tenant is the verified JWT's own (index.ts); there is no
 * body at all.
 */
export interface BusinessLocationDeps {
  fetchImpl: CensusFetch;
  logger: Logger;
  timeoutMs?: number;
}

export type BusinessLocationResult =
  | { status: 200; body: { matched_address: string | null; lat: number; lng: number } }
  | { status: 200; body: { error: "not_found" | "lookup_unavailable" | "address_incomplete" } }
  | { status: 404; body: { error: "tenant_not_found" } };

/** Owner is waiting on a page, not a caller on a phone line: a little more patience than the hot path. */
const PORTAL_GEOCODE_TIMEOUT_MS = 5_000;

export async function handleBusinessLocation(
  sql: SqlClient,
  tenantId: string,
  deps: BusinessLocationDeps,
): Promise<BusinessLocationResult> {
  const settings = await loadDeliverySettings(sql, tenantId);
  if (!settings) return { status: 404, body: { error: "tenant_not_found" } };

  const outcome = await resolveBusinessLocation(sql, settings, {
    fetchImpl: deps.fetchImpl,
    timeoutMs: deps.timeoutMs ?? PORTAL_GEOCODE_TIMEOUT_MS,
    logger: deps.logger,
    force: true,
  });
  if (!outcome.ok) {
    deps.logger.info("tenant_business_location_unresolved", {
      tenant_id: tenantId,
      reason: outcome.reason,
    });
    return { status: 200, body: { error: outcome.reason } };
  }
  deps.logger.info("tenant_business_located", { tenant_id: tenantId });
  return {
    status: 200,
    body: {
      matched_address: outcome.location.matched,
      lat: outcome.location.lat,
      lng: outcome.location.lng,
    },
  };
}
