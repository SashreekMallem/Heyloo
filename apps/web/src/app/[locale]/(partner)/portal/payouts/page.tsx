import { PageHeader } from "@heyloo/ui/layout/page-header";
import type { Metadata } from "next";
import { type PayoutRow, PayoutsTableClient } from "@/components/partner/payouts-table-client";
import { requirePartnerSession } from "@/lib/auth/require-partner-session";

export const metadata: Metadata = { title: "Payouts — Heyloo" };

/**
 * `referral_payouts`'s real columns are `total_cents`/`period`/`status`
 * (`supabase/migrations/20260907130800_referrals.sql`) — there is no
 * `amount_cents`/`method`/`paid_at` column, despite `@heyloo/supabase-
 * client`'s hand-maintained `ReferralPayoutRow` claiming those (a stale
 * type, filed in docs/audit/FIX_REQUESTS.md); the previous version of this
 * page selected the wrong columns entirely, which would 400 against the
 * real schema. Payout method is constant per partner (`payout_method`),
 * shown once above the table rather than repeated per row.
 */
export default async function PayoutsPage() {
  const { supabase, partner } = await requirePartnerSession("/portal/payouts");

  const [{ data: payouts }, { data: partnerRow }] = await Promise.all([
    supabase
      .from("referral_payouts")
      .select("id, total_cents, period, status, created_at")
      .eq("referral_partner_id", partner.id)
      .order("period", { ascending: false }),
    supabase.from("referral_partners").select("payout_method").eq("id", partner.id).maybeSingle(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payouts"
        description={
          <span>
            Paid via{" "}
            <span className="capitalize">
              {(partnerRow?.payout_method ?? "paypal").replace(/_/g, " ")}
            </span>
          </span>
        }
      />
      <PayoutsTableClient payouts={(payouts ?? []) as unknown as PayoutRow[]} />
    </div>
  );
}
