import { NextResponse } from "next/server";
import { z } from "zod";
import { claimsFromSupabaseClient } from "@/lib/auth/claims";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";
import { createSupabaseServiceRoleServerClient } from "@/lib/supabase/service-role";

export const runtime = "nodejs";

/**
 * Dashboard → Setup → Resources (rooms/bays/chairs/tables/staff/agent
 * lines) — GAP_REGISTER.md §4 Cluster E. `resources.room_type` is a real
 * column (`20260910121000_resources_room_type.sql`, motel room tiers) not
 * yet declared on the hand-maintained `ResourceRow` type
 * (`packages/supabase-client/src/database.types.ts`) — see
 * docs/audit/FIX_REQUESTS.md; select/insert strings aren't statically
 * checked against that type (confirmed empirically — an unrecognized
 * column widens the query's inferred type rather than erroring at the
 * call site, only surfacing once a property is read off an uncast result),
 * so this route reads/writes the live column today rather than waiting.
 * Writes go through `resources_write` RLS (owner/admin only,
 * `20260907131500_rls.sql`) using the caller's own session — this route's
 * own `tenant_id` filter is the CLAUDE.md Rule 2 "still explicitly filter"
 * belt-and-suspenders, not the only guard.
 */
const resourceSchema = z.object({
  type: z.enum(["chair", "room", "table", "bay", "staff", "agent"]),
  name: z.string().trim().min(1, "Name is required").max(200),
  capacity: z.number().int().positive().max(10_000).default(1),
  room_type: z.string().trim().min(1).max(100).nullish(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  active: z.boolean().default(true),
});

export async function GET() {
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

  const { data, error } = await supabase
    .from("resources")
    .select("id, type, name, capacity, active, metadata, room_type")
    .eq("tenant_id", claims.tenant_id)
    .order("type", { ascending: true })
    .order("name", { ascending: true });
  if (error) return NextResponse.json({ error: "fetch_failed" }, { status: 500 });
  return NextResponse.json({ resources: data ?? [] });
}

export async function POST(request: Request) {
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
  const parsed = resourceSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const { data, error } = await supabase
    .from("resources")
    .insert({ ...parsed.data, tenant_id: claims.tenant_id })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: "insert_failed" }, { status: 500 });

  // ONBOARD-1 (docs/BUILD_NOTES.md): `public.availability_slots` is only
  // ever populated by `fn_regenerate_availability_slots` — this route's own
  // insert above is the ONLY place a resource is created, and before this
  // fix nothing ever called that function for it. The one thing that did
  // call it was `fn_cron_availability_rollforward`, scheduled once daily at
  // 04:00 UTC (`supabase/migrations/20260910093000_queues_and_scheduled_jobs.sql`)
  // — so a resource created through this route had ZERO bookable slots
  // (`check_availability` always returned `none_available: true`, live-
  // confirmed against a real batch-test run against `signup-1-auto`, a
  // fresh tenant with no resources) until up to 24 hours later. That
  // directly breaks "can a customer set up and start working instantly?" —
  // this task's own owner-facing question. `fn_regenerate_availability_slots`
  // has no client write policy on `availability_slots`
  // (`supabase/migrations/20260907131500_rls.sql`: "generated/invalidated
  // by functions & triggers via service_role") and is not `security
  // definer`, so it can't be called under the tenant owner's own RLS-scoped
  // session above — narrowly scoped service-role client instead, called
  // ONLY with this request's own already-authorized `claims.tenant_id` and
  // the resource id this same request's insert just created (never
  // client-supplied), mirroring `refer/ensure-link/route.ts`'s existing
  // narrow service-role-in-a-Route-Handler pattern. Best-effort: a failure
  // here never fails the resource creation itself (the resource still
  // exists and will still get slots from the next nightly rollforward) —
  // logged instead.
  const service = createSupabaseServiceRoleServerClient();
  const { error: slotsError } = await service.rpc("fn_regenerate_availability_slots", {
    p_tenant_id: claims.tenant_id,
    p_resource_id: data.id,
    p_days_ahead: null,
  });
  if (slotsError) {
    console.error("resource_availability_slots_regeneration_failed", {
      tenant_id: claims.tenant_id,
      resource_id: data.id,
      error: slotsError,
    });
  }

  return NextResponse.json({ ok: true, id: data.id });
}
