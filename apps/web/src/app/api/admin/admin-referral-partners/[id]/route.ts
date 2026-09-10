import { NextResponse } from "next/server";
import {
  fromUntypedTable,
  requireAdminApiSession,
  writeAdminAction,
} from "@/app/api/admin/_lib/admin-auth";
import { partnerCommissionTermsSchema } from "@/app/api/admin/_lib/referral-partner-schema";
import { createSupabaseServiceRoleServerClient } from "@/lib/supabase/service-role";

export const runtime = "nodejs";

interface PartnerDetail {
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

interface OverrideRow {
  vertical: string;
  rate_bps: number | null;
  commission_base: "gross_profit" | "revenue" | null;
  duration_months: number | null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminApiSession();
  if (!session.ok) return session.response;
  const { id } = await params;

  const supabase = createSupabaseServiceRoleServerClient();
  const { data: partner } = await supabase
    .from("referral_partners")
    .select(
      "id, name, email, payout_method, w9_status, ytd_payout_cents, rate_bps, commission_base, duration_months",
    )
    .eq("id", id)
    .maybeSingle();
  if (!partner) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { data: overrides } = await fromUntypedTable(
    supabase,
    "referral_partner_vertical_overrides",
  )
    .select("vertical, rate_bps, commission_base, duration_months")
    .eq("referral_partner_id", id)
    .order("vertical", { ascending: true });

  return NextResponse.json({
    partner: partner as unknown as PartnerDetail,
    overrides: (overrides ?? []) as unknown as OverrideRow[],
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminApiSession();
  if (!session.ok) return session.response;
  const { id } = await params;

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = partnerCommissionTermsSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const supabase = createSupabaseServiceRoleServerClient();
  const { data: before } = await supabase
    .from("referral_partners")
    .select("id, rate_bps, commission_base, duration_months")
    .eq("id", id)
    .maybeSingle();
  if (!before) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { data: after, error } = await supabase
    .from("referral_partners")
    // biome-ignore lint/suspicious/noExplicitAny: rate_bps/commission_base/duration_months postdate @heyloo/supabase-client's hand-maintained ReferralPartnerRow update type — see file header.
    .update(parsed.data as any)
    .eq("id", id)
    .select("id, rate_bps, commission_base, duration_months")
    .maybeSingle();
  if (error || !after) return NextResponse.json({ error: "update_failed" }, { status: 500 });

  await writeAdminAction({
    adminUserId: session.adminUserId,
    action: "referral_partner_commission_terms_edit",
    targetType: "referral",
    targetId: id,
    before: before as unknown as Record<string, unknown>,
    after: after as unknown as Record<string, unknown>,
  });

  return NextResponse.json({ partner: after });
}
