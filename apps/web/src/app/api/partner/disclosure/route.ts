import { ftcDisclosureAckSchema } from "@heyloo/canonical-types";
import { NextResponse } from "next/server";
import { claimsFromUser } from "@/lib/auth/claims";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * FTC disclosure acknowledgment (FRONTEND_SPEC.md §8.4). VERIFY
 * (docs/VERIFY.md): `referral_partners.ftc_acknowledged_at`/
 * `ftc_acknowledged_version` are assumed per the spec's exact wording but
 * do not exist in the actual migration
 * (`supabase/migrations/20260907130800_referrals.sql`) — this write will
 * fail until that column pair is added; flagged for the backend, not
 * silently worked around with a different storage shape.
 */
export async function POST(request: Request) {
  const supabase = await createSupabaseServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const claims = claimsFromUser(user);
  if (!claims.referral_partner_id)
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = ftcDisclosureAckSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 422 });

  const { error } = await supabase
    .from("referral_partners")
    .update({
      ftc_acknowledged_at: new Date().toISOString(),
      ftc_acknowledged_version: parsed.data.policy_version,
    })
    .eq("id", claims.referral_partner_id);

  if (error)
    return NextResponse.json({ error: "update_failed", detail: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
