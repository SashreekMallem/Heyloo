import type { ResourceRow, UpdateOf } from "@heyloo/supabase-client";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  clearFutureResourceAvailability,
  regenerateResourceAvailability,
} from "@/lib/settings/availability";
import { parseBody, requireTenantWriter, updateResult } from "@/lib/settings/route-auth";

export const runtime = "nodejs";

const resourceUpdateSchema = z.object({
  type: z.enum(["chair", "room", "table", "bay", "staff", "agent"]).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  capacity: z.number().int().positive().max(10_000).optional(),
  room_type: z.string().trim().min(1).max(100).nullish(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  active: z.boolean().optional(),
  // SETTINGS-1 — see `../route.ts`. `slot_minutes: null` resets to the
  // generator's default (30, motel 1440).
  buffer_minutes: z.number().int().min(0).max(240).optional(),
  slot_minutes: z.number().int().min(5).max(1440).nullish(),
});

/** 502 when a removed resource's future times could not be taken off sale — nothing was changed, so the owner can retry. */
function slotsNotCleared() {
  return NextResponse.json({ error: "slots_not_cleared" }, { status: 502 });
}

/**
 * SETTINGS-1: every PATCH that can change bookable times is applied to
 * `availability_slots` right away — the resource is regenerated if it is
 * (still) active, or its future generated slots are removed if it was just
 * deactivated. Before, only CREATE regenerated (ONBOARD-1), so an edited
 * slot length/buffer/capacity waited for the 04:00 UTC rollforward and a
 * deactivated resource stayed bookable until its old slots passed.
 *
 * SETTINGS-1 review:
 * - Owner/admin only (`requireTenantWriter`), and a write RLS filtered to
 *   zero rows is a 404 — both BEFORE any service-role slot work. A
 *   `member`'s update used to be silently dropped by RLS while the
 *   service-role clear still ran, so a member could wipe a resource's
 *   future availability they aren't allowed to edit.
 * - Deactivating clears the future slots FIRST and stops (502, nothing
 *   changed) if that fails. The nightly roll-forward only touches ACTIVE
 *   resources and `check_availability` doesn't filter on
 *   `resources.active`, so a deactivated resource whose slots weren't
 *   cleared stayed bookable for up to 3 weeks with no way to retry (it
 *   disappears from Setup → Resources). A failed REGENERATION after an
 *   edit is still best-effort: the resource stays active, so the nightly
 *   roll-forward repairs it.
 */

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireTenantWriter();
  if (!auth.ok) return auth.response;
  const { supabase, tenantId } = auth;

  const body = await parseBody(request, resourceUpdateSchema);
  if (!body.ok) return body.response;

  const { data: existing } = await supabase
    .from("resources")
    .select("id, metadata, active")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { slot_minutes: slotMinutes, ...changes } = body.data;
  const update: typeof changes = { ...changes };
  if (slotMinutes !== undefined) {
    const metadata = { ...(changes.metadata ?? existing.metadata ?? {}) } as Record<
      string,
      unknown
    >;
    if (slotMinutes === null) delete metadata["slot_minutes"];
    else metadata["slot_minutes"] = slotMinutes;
    update.metadata = metadata;
  }

  const nowActive = update.active ?? existing.active ?? true;
  if (!nowActive && !(await clearFutureResourceAvailability(tenantId, id))) {
    return slotsNotCleared();
  }

  const result = await supabase
    .from("resources")
    // `buffer_minutes` — see `../route.ts` (real column, missing from `ResourceRow`).
    .update(update as UpdateOf<ResourceRow>)
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select("id");
  const written = updateResult(result);
  if (!written.ok) return written.response;

  const slotsUpdated = nowActive ? await regenerateResourceAvailability(tenantId, id) : true;
  return NextResponse.json({ ok: true, slots_updated: slotsUpdated });
}

/** Soft delete only — a `resources` row is referenced by `bookings`/
 * `availability_slots` (FK, no cascade) so a hard delete would fail or
 * orphan history; deactivating removes it from availability generation and
 * the setup list without destroying past bookings. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireTenantWriter();
  if (!auth.ok) return auth.response;
  const { supabase, tenantId } = auth;

  const { data: existing } = await supabase
    .from("resources")
    .select("id")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // SETTINGS-1 review: take its future times off sale first (see above).
  if (!(await clearFutureResourceAvailability(tenantId, id))) return slotsNotCleared();

  const result = await supabase
    .from("resources")
    .update({ active: false })
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select("id");
  const written = updateResult(result);
  if (!written.ok) return written.response;

  return NextResponse.json({ ok: true, slots_updated: true });
}
