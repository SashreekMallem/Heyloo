import type { Metadata } from "next";
import { PayoutsTableClient } from "@/components/partner/payouts-table-client";
import { requirePartnerSession } from "@/lib/auth/require-partner-session";

export const metadata: Metadata = { title: "Payouts — Heyloo" };

export default async function PayoutsPage() {
  const { supabase, partner } = await requirePartnerSession("/portal/payouts");

  const { data: payouts } = await supabase
    .from("referral_payouts")
    .select("id, amount_cents, method, status, created_at")
    .eq("referral_partner_id", partner.id)
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Payouts</h1>
      <PayoutsTableClient payouts={payouts ?? []} />
    </div>
  );
}
