import { NextResponse } from "next/server";
import { z } from "zod";
import { claimsFromSupabaseClient } from "@/lib/auth/claims";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";

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
  return NextResponse.json({ ok: true, id: data.id });
}
