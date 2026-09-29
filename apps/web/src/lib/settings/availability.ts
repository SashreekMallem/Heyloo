import "server-only";

import { createSupabaseServiceRoleServerClient } from "@/lib/supabase/service-role";

/**
 * SETTINGS-1: make hours / time-zone / resource edits bookable (or
 * un-bookable) immediately instead of at the nightly 04:00 UTC
 * `fn_cron_availability_rollforward`.
 *
 * `availability_slots` has no client write policy and
 * `fn_regenerate_availability_slots` is not `security definer`, so this
 * uses the narrowly scoped service-role client exactly like ONBOARD-1's
 * `POST /api/tenant/resources`: only ever called with a tenant id taken
 * from the caller's verified JWT (and resource ids re-read under that
 * tenant), never with anything from the request body. Best-effort — the
 * setting itself is already saved; a failure is logged and reported back
 * so the UI can say "takes effect overnight" instead of "live now".
 */

const CONCURRENCY = 4;

export interface RegenerationResult {
  resources: number;
  failed: number;
}

async function regenerateOne(
  service: ReturnType<typeof createSupabaseServiceRoleServerClient>,
  tenantId: string,
  resourceId: string,
): Promise<boolean> {
  const { error } = await service.rpc("fn_regenerate_availability_slots", {
    p_tenant_id: tenantId,
    p_resource_id: resourceId,
    p_days_ahead: null,
  });
  if (error) {
    console.error("availability_regeneration_failed", {
      tenant_id: tenantId,
      resource_id: resourceId,
      error,
    });
    return false;
  }
  return true;
}

/** Rebuild future slots for every ACTIVE resource of the tenant (hours or time zone changed). */
export async function regenerateTenantAvailability(tenantId: string): Promise<RegenerationResult> {
  const service = createSupabaseServiceRoleServerClient();
  const { data, error } = await service
    .from("resources")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("active", true);
  if (error) {
    console.error("availability_regeneration_resources_read_failed", {
      tenant_id: tenantId,
      error,
    });
    return { resources: 0, failed: 1 };
  }
  const ids = (data ?? []).map((row) => row.id);
  let failed = 0;
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const batch = ids.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((id) => regenerateOne(service, tenantId, id)));
    failed += results.filter((ok) => !ok).length;
  }
  return { resources: ids.length, failed };
}

/** Rebuild one resource's future slots (its slot length / buffer / capacity changed, or it was re-activated). */
export async function regenerateResourceAvailability(
  tenantId: string,
  resourceId: string,
): Promise<boolean> {
  return regenerateOne(createSupabaseServiceRoleServerClient(), tenantId, resourceId);
}

/**
 * Remove a deactivated resource's future generated slots. The nightly
 * rollforward only regenerates ACTIVE resources and `check_availability`
 * without a type filter does not join `resources.active`, so without this
 * a removed bay/room/staff member stays bookable until its old slots pass.
 */
export async function clearFutureResourceAvailability(
  tenantId: string,
  resourceId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const service = createSupabaseServiceRoleServerClient();
  const { error } = await service
    .from("availability_slots")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("resource_id", resourceId)
    .eq("source", "generated")
    .rangeGte("slot_range", `[${now.toISOString()},)`);
  if (error) {
    console.error("availability_clear_failed", {
      tenant_id: tenantId,
      resource_id: resourceId,
      error,
    });
    return false;
  }
  return true;
}
