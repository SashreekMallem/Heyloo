import { NextResponse } from "next/server";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";
import { createSupabaseServiceRoleServerClient } from "@/lib/supabase/service-role";
import { computeReferralFunnel, isApproachingW9Threshold } from "./funnel";

export const runtime = "nodejs";

function randomCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

/**
 * Tenant "refer & earn" (FRONTEND_SPEC.md §6.10) — "a tenant generating a
 * link auto-provisions a `referral_partners` row scoped to their user."
 * `referral_partners` has no client insert policy (service_role only, same
 * shape as `tenants`/`memberships` at signup) — this Route Handler does
 * the find-or-create.
 */
export async function POST() {
  const supabase = await createSupabaseServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

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

  const { data: existingLink } = await service
    .from("referral_links")
    .select("code")
    .eq("referral_partner_id", partnerId)
    .maybeSingle();

  const code =
    existingLink?.code ??
    (
      await service
        .from("referral_links")
        .insert({ referral_partner_id: partnerId, code: randomCode() })
        .select("code")
        .single()
    ).data?.code;

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
