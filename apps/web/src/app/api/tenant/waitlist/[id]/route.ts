import { NextResponse } from "next/server";
import { claimsFromSupabaseClient } from "@/lib/auth/claims";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const ALLOWED_STATUSES = ["active", "notified", "converted", "expired"] as const;
type WaitlistStatus = (typeof ALLOWED_STATUSES)[number];

function isWaitlistStatus(value: unknown): value is WaitlistStatus {
  return typeof value === "string" && (ALLOWED_STATUSES as readonly string[]).includes(value);
}

/**
 * Waitlist section under Bookings (MASTER_SPEC.md §3.4/§3.10) — the only
 * owner-initiated mutation the dashboard needs today is removing/expiring
 * an entry; `waitlist_entries` otherwise transitions via the backend
 * cancellation-trigger/two-way-SMS pipeline (§3.4).
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
  const status = (json as { status?: unknown }).status;
  if (!isWaitlistStatus(status)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 422 });
  }

  const { data: entry, error: fetchError } = await supabase
    .from("waitlist_entries")
    .select("id")
    .eq("id", id)
    .eq("tenant_id", claims.tenant_id)
    .maybeSingle();
  if (fetchError || !entry) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { error } = await supabase
    .from("waitlist_entries")
    .update({ status })
    .eq("id", id)
    .eq("tenant_id", claims.tenant_id);
  if (error) return NextResponse.json({ error: "update_failed" }, { status: 500 });

  return NextResponse.json({ ok: true });
}
