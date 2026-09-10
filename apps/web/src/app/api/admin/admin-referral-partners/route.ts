import { NextResponse } from "next/server";
import { requireAdminApiSession } from "@/app/api/admin/_lib/admin-auth";
import { createSupabaseServiceRoleServerClient } from "@/lib/supabase/service-role";

export const runtime = "nodejs";

/**
 * Admin partners page (Cluster H task brief item 4). `supabase/functions/
 * admin/handler.ts` has no `admin-referral-partners` route at all (its
 * `admin-referrals` route only surfaces the aggregated `v_referral_pnl`
 * payout view, not the raw admin-editable commission-terms columns) — that
 * file is outside this cluster's ownership, so this reads Postgres
 * directly (service role), same rationale as `admin-support-requests`.
 * `referral_partners.rate_bps`/`.commission_base`/`.duration_months`
 * (added by `20260910140000_referral_commission_recurring.sql`, Cluster
 * G) are not yet in `@heyloo/supabase-client`'s hand-maintained
 * `ReferralPartnerRow` type — selected with an explicit column list and
 * cast, matching the established workaround (docs/audit/FIX_REQUESTS.md).
 */
interface PartnerRow {
  id: string;
  name: string;
  email: string;
  payout_method: string;
  w9_status: string;
  ytd_payout_cents: number;
  rate_bps: number | null;
  commission_base: "gross_profit" | "revenue";
  duration_months: number | null;
}

export async function GET() {
  const session = await requireAdminApiSession();
  if (!session.ok) return session.response;

  const supabase = createSupabaseServiceRoleServerClient();
  const { data, error } = await supabase
    .from("referral_partners")
    .select(
      "id, name, email, payout_method, w9_status, ytd_payout_cents, rate_bps, commission_base, duration_months",
    )
    .order("name", { ascending: true });

  if (error) return NextResponse.json({ error: "query_failed" }, { status: 500 });

  return NextResponse.json({ rows: (data ?? []) as unknown as PartnerRow[] });
}
