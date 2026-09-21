import { reminderReviewSettingsSchema } from "@heyloo/canonical-types";
import { NextResponse } from "next/server";
import { claimsFromSupabaseClient } from "@/lib/auth/claims";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Agent settings → Vertical details tab: reminders/review toggles +
 * `review_url` + avg-ticket field (MASTER_SPEC.md §3.6/§3.8/§3.9/§3.10),
 * server-side validated against `reminderReviewSettingsSchema` and written
 * to the real `tenants` columns (`voice_reminders_enabled`,
 * `review_request_enabled`, `review_url`, `avg_transaction_value_cents`).
 */
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

  const parsed = reminderReviewSettingsSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const { error } = await supabase
    .from("tenants")
    .update({
      voice_reminders_enabled: parsed.data.voice_reminders_enabled,
      review_request_enabled: parsed.data.review_request_enabled,
      review_url: parsed.data.review_url ?? null,
      avg_transaction_value_cents: parsed.data.avg_transaction_value_cents,
    })
    .eq("id", claims.tenant_id);

  if (error) return NextResponse.json({ error: "update_failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
