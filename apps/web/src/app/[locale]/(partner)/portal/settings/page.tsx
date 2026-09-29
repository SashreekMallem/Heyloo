import { PageHeader } from "@heyloo/ui/layout/page-header";
import { PayoutSettingsForm } from "@/components/partner/payout-settings-form";
import { requirePartnerSession } from "@/lib/auth/require-partner-session";

export default async function PartnerSettingsPage() {
  const { supabase, partner } = await requirePartnerSession("/portal/settings");

  // Read through the partner's own RLS-bound session (same as every other
  // portal page). `paypal_email` is deliberately not in
  // `requirePartnerSession`'s shared select: only this page needs it.
  const { data: row } = await supabase
    .from("referral_partners")
    .select("paypal_email")
    .eq("id", partner.id)
    .maybeSingle();

  return (
    <div className="max-w-md space-y-6">
      <PageHeader title="Settings" description="Where we send your commission payouts." />
      <PayoutSettingsForm partnerId={partner.id} initialEmail={row?.paypal_email ?? ""} />
    </div>
  );
}
