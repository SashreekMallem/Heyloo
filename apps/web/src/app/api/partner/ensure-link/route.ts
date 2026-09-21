import { NextResponse } from "next/server";
import { claimsFromSupabaseClient } from "@/lib/auth/claims";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";
import { ensurePartnerReferralLink } from "../_lib/ensure-referral-link";

export const runtime = "nodejs";

/**
 * Find-or-create the caller's own referral link (ADMIN-R4 partner
 * dashboard stall fix). The portal's server component calls
 * `ensurePartnerReferralLink` directly for its own render; this route
 * exists so a client component can re-check/create on demand (e.g. a
 * future "regenerate" affordance) without needing service-role access
 * itself.
 */
export async function POST() {
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
  if (!claims.referral_partner_id)
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const code = await ensurePartnerReferralLink(claims.referral_partner_id);
  if (!code) return NextResponse.json({ error: "link_create_failed" }, { status: 500 });

  return NextResponse.json({ code });
}
