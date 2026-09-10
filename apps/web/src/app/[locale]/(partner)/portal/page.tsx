import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  FunnelChart,
  MetricCard,
  PageHeader,
} from "@heyloo/ui";
import type { Metadata } from "next";
import { ensurePartnerReferralLink } from "@/app/api/partner/_lib/ensure-referral-link";
import { CopyLinkButton } from "@/components/partner/copy-link-button";
import { requirePartnerSession } from "@/lib/auth/require-partner-session";

export const metadata: Metadata = { title: "Partner dashboard — Heyloo" };

export default async function PartnerDashboardPage() {
  const { supabase, partner } = await requirePartnerSession("/portal");

  // Find-or-create: a referral_partners row provisioned by an admin has no
  // guarantee a referral_links row was ever created for it (the tenant
  // self-referral flow had a find-or-create step; this one didn't), so a
  // plain read here could show "Generating…" forever. Resolve it eagerly
  // so the real link is present by first paint.
  const code = await ensurePartnerReferralLink(partner.id);

  const { data: referrals } = await supabase
    .from("referrals")
    .select("status")
    .eq("referral_partner_id", partner.id);

  const rows = referrals ?? [];
  const qualified = rows.filter((r) => r.status === "qualified" || r.status === "paid").length;
  const paid = rows.filter((r) => r.status === "paid").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Your referral funnel and where each customer stands."
      />

      {rows.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            No referrals yet — share your link below. You earn a bonus after a referral completes
            their 2nd paid month.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <MetricCard label="Referrals" value={rows.length} format="number" />
          <MetricCard label="Qualified" value={qualified} format="number" />
          <MetricCard label="Paid" value={paid} format="number" />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your link</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-2">
          <code className="flex-1 truncate rounded-md border border-border bg-muted/50 px-3 py-2 font-mono text-small">
            {code ? `/signup?ref=${code}` : "Link unavailable — try refreshing the page."}
          </code>
          {code && <CopyLinkButton code={code} />}
        </CardContent>
      </Card>

      <FunnelChart
        stages={[
          { label: "Clicks", count: 0 },
          { label: "Signups", count: rows.length },
          { label: "Qualified", count: qualified },
          { label: "Paid", count: paid },
        ]}
      />
    </div>
  );
}
