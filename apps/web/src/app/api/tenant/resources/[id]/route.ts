import type { ResourceRow, UpdateOf } from "@heyloo/supabase-client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { claimsFromSupabaseClient } from "@/lib/auth/claims";
import {
  clearFutureResourceAvailability,
  regenerateResourceAvailability,
} from "@/lib/settings/availability";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";

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

/**
 * SETTINGS-1: every PATCH that can change bookable times is applied to
 * `availability_slots` right away — the resource is regenerated if it is
 * (still) active, or its future generated slots are removed if it was just
 * deactivated. Before, only CREATE regenerated (ONBOARD-1), so an edited
 * slot length/buffer/capacity waited for the 04:00 UTC rollforward and a
 * deactivated resource stayed bookable until its old slots passed.
 */

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  // AUTH-1 fix (docs/BUILD_NOTES.md, SIGNUP-1 root cause #3): claims live
  // only in the JWT itself, never in the User/session object's
  // app_metadata; claimsFromUser(user) always evaluated to {} for a real
  // tenant/admin/partner here.
  const claims = await claimsFromSupabaseClient(supabase);
  if (!claims.tenant_id) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = resourceUpdateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const { data: existing } = await supabase
    .from("resources")
    .select("id, metadata, active")
    .eq("id", id)
    .eq("tenant_id", claims.tenant_id)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { slot_minutes: slotMinutes, ...changes } = parsed.data;
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

  const { error } = await supabase
    .from("resources")
    // `buffer_minutes` — see `../route.ts` (real column, missing from `ResourceRow`).
    .update(update as UpdateOf<ResourceRow>)
    .eq("id", id)
    .eq("tenant_id", claims.tenant_id);
  if (error) return NextResponse.json({ error: "update_failed" }, { status: 500 });

  const nowActive = update.active ?? existing.active ?? true;
  const slotsUpdated = nowActive
    ? await regenerateResourceAvailability(claims.tenant_id, id)
    : await clearFutureResourceAvailability(claims.tenant_id, id);
  return NextResponse.json({ ok: true, slots_updated: slotsUpdated });
}

/** Soft delete only — a `resources` row is referenced by `bookings`/
 * `availability_slots` (FK, no cascade) so a hard delete would fail or
 * orphan history; deactivating removes it from availability generation and
 * the setup list without destroying past bookings. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  // AUTH-1 fix (docs/BUILD_NOTES.md, SIGNUP-1 root cause #3): claims live
  // only in the JWT itself, never in the User/session object's
  // app_metadata; claimsFromUser(user) always evaluated to {} for a real
  // tenant/admin/partner here.
  const claims = await claimsFromSupabaseClient(supabase);
  if (!claims.tenant_id) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { data: existing } = await supabase
    .from("resources")
    .select("id")
    .eq("id", id)
    .eq("tenant_id", claims.tenant_id)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { error } = await supabase
    .from("resources")
    .update({ active: false })
    .eq("id", id)
    .eq("tenant_id", claims.tenant_id);
  if (error) return NextResponse.json({ error: "update_failed" }, { status: 500 });

  // SETTINGS-1: stop offering the removed resource's future times now.
  const slotsUpdated = await clearFutureResourceAvailability(claims.tenant_id, id);
  return NextResponse.json({ ok: true, slots_updated: slotsUpdated });
}
