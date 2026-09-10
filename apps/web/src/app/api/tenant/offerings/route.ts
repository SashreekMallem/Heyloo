import { NextResponse } from "next/server";
import { claimsFromUser } from "@/lib/auth/claims";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";
import { offeringWriteSchema } from "./schema";

export const runtime = "nodejs";

/**
 * Dashboard → Setup → Offerings/Menu — GAP_REGISTER.md §4 Cluster E.
 * `@heyloo/canonical-types`' `offeringSchema` covers the Agent → Services
 * tab's plain name/duration/price fields (FRONTEND_SPEC.md §6.6); this
 * route extends it with the columns that tab doesn't expose —
 * `category`/`resource_type_required`/`active` and a `metadata` shape for
 * modifiers + allergens (restaurant menu items, GAP_REGISTER.md §1.11 +
 * §2 Restaurant), matching what `create_order.ts`/`check_availability.ts`
 * already read off `offerings.metadata`/`resources_type_required`.
 */
export async function GET() {
  const supabase = await createSupabaseServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const claims = claimsFromUser(user);
  if (!claims.tenant_id) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { data, error } = await supabase
    .from("offerings")
    .select(
      "id, name, category, duration_minutes, price_cents, resource_type_required, metadata, active",
    )
    .eq("tenant_id", claims.tenant_id)
    .order("category", { ascending: true, nullsFirst: false })
    .order("name", { ascending: true });
  if (error) return NextResponse.json({ error: "fetch_failed" }, { status: 500 });
  return NextResponse.json({ offerings: data ?? [] });
}

export async function POST(request: Request) {
  const supabase = await createSupabaseServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const claims = claimsFromUser(user);
  if (!claims.tenant_id) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = offeringWriteSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const { data, error } = await supabase
    .from("offerings")
    .insert({ ...parsed.data, tenant_id: claims.tenant_id })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  return NextResponse.json({ ok: true, id: data.id });
}
