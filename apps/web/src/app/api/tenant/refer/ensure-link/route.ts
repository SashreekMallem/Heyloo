import { NextResponse } from "next/server";
import { ensurePartnerReferralLink } from "@/app/api/partner/_lib/ensure-referral-link";
import { claimsFromSupabaseClient } from "@/lib/auth/claims";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";
import { createSupabaseServiceRoleServerClient } from "@/lib/supabase/service-role";
import { computeReferralFunnel, isApproachingW9Threshold } from "./funnel";

export const runtime = "nodejs";

/**
 * Tenant "refer & earn" (FRONTEND_SPEC.md §6.10) — "a tenant generating a
 * link auto-provisions a `referral_partners` row scoped to their user."
 * `referral_partners` has no client insert policy (service_role only, same
 * shape as `tenants`/`memberships` at signup) — this Route Handler does
 * the find-or-create.
 *
 * SEC-11: only a tenant's owner or admin may enrol as a referrer here. A
 * signed-in user with no tenant, or a plain `member`, used to be enrolled
 * as a partner (via the service role) too. The role comes from the JWT
 * claims only (`claimsFromSupabaseClient`), never from the request. Link
 * codes are drawn from the CSPRNG and retried on a unique-code collision
 * (`ensurePartnerReferralLink`).
 */
export async function POST() {
  const supabase = await createSupabaseServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const claims = await claimsFromSupabaseClient(supabase);
  if (!claims.tenant_id) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (claims.role !== "owner" && claims.role !== "admin") {
    return NextResponse.json({ error: "owner_or_admin_required" }, { status: 403 });
  }

  const service = createSupabaseServiceRoleServerClient();

  const { data: existingPartner } = await service
    .from("referral_partners")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  const partnerId =
    existingPartner?.id ??
    (
      await service
        .from("referral_partners")
        .insert({
          user_id: user.id,
          name: user.email ?? "Tenant referrer",
          email: user.email ?? "",
        })
        .select("id")
        .single()
    ).data?.id;

  if (!partnerId) return NextResponse.json({ error: "partner_create_failed" }, { status: 500 });

  const code = await ensurePartnerReferralLink(partnerId);
  if (!code) return NextResponse.json({ error: "link_create_failed" }, { status: 500 });

  const [{ data: referrals }, { data: partner }] = await Promise.all([
    service.from("referrals").select("status").eq("referral_partner_id", partnerId),
    service
      .from("referral_partners")
      .select("ytd_payout_cents, w9_status")
      .eq("id", partnerId)
      .maybeSingle(),
  ]);

  const funnel = computeReferralFunnel(referrals ?? []);
  const ytdPayoutCents = partner?.ytd_payout_cents ?? 0;
  const w9Status = partner?.w9_status ?? "not_submitted";

  return NextResponse.json({
    code,
    partner_id: partnerId,
    funnel,
    w9_status: w9Status,
    ytd_payout_cents: ytdPayoutCents,
    approaching_w9_threshold: isApproachingW9Threshold(ytdPayoutCents, w9Status),
  });
}
