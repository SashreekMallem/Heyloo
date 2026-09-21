import { NextResponse } from "next/server";
import { z } from "zod";
import { claimsFromSupabaseClient } from "@/lib/auth/claims";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";
import { offeringWriteSchema } from "../schema";

export const runtime = "nodejs";

/**
 * Confirms a batch of offerings after the tenant reviews a menu import
 * (dashboard/setup/offerings/import) — the import endpoint itself only
 * PARSES a menu into candidate rows (GAP_REGISTER.md §4 Cluster E "menu
 * import UI calling cluster G's api-menu-import"), it never writes
 * `offerings` directly; this route is the one write path, reusing the same
 * per-row validation as a single create so a bulk-imported row can never
 * skip it. Capped at 200 rows/request — a real menu/room list, not an
 * accidental unbounded payload.
 */
const bulkSchema = z.object({
  offerings: z.array(offeringWriteSchema).min(1).max(200),
});

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
  const parsed = bulkSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const rows = parsed.data.offerings.map((o) => ({ ...o, tenant_id: claims.tenant_id as string }));
  const { data, error } = await supabase.from("offerings").insert(rows).select("id");
  if (error) return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  return NextResponse.json({ ok: true, created: data?.length ?? 0 });
}
