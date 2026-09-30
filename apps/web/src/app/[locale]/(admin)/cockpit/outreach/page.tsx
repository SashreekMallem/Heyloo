"use client";

import {
  Callout,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataState,
  EmptyState,
  MetricCard,
  PageHeader,
} from "@heyloo/ui";
import { FunnelChart } from "@heyloo/ui/charts";
import { Link } from "@/i18n/navigation";
import { useAdminQuery } from "@/lib/hooks/use-admin-query";
import { buildOutreachFunnel, type LeadStatusCount, summarizeCac } from "./funnel";

/** `GET admin-outreach/funnel` (supabase/functions/admin/handler.ts). */
interface OutreachFunnelResponse {
  leads_by_status: LeadStatusCount[];
  replies_by_intent: { ai_intent: string | null; count: number }[];
  complaint_rate_pct?: number;
}

/** `GET admin-cac` — the channel-level rollup the CAC page also reads. */
interface CacResponse {
  channels?: { total_cost_cents: number; converted_tenant_count: number }[];
}

export default function OutreachOverviewPage() {
  const query = useAdminQuery<OutreachFunnelResponse>(
    "outreach-overview",
    [],
    "admin-outreach/funnel",
  );
  const cacQuery = useAdminQuery<CacResponse>("outreach-cac", [], "admin-cac");
  const cacCents = summarizeCac(cacQuery.data?.channels);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Outreach"
        description="Cold-outbound funnel, complaint rate, and acquisition cost."
        actions={
          <nav className="flex flex-wrap gap-4 text-small font-medium text-muted-foreground">
            <Link href="/cockpit/outreach/campaigns" className="hover:text-foreground">
              Campaigns
            </Link>
            <Link href="/cockpit/outreach/leads" className="hover:text-foreground">
              Leads
            </Link>
            <Link href="/cockpit/outreach/replies" className="hover:text-foreground">
              Replies
            </Link>
          </nav>
        }
      />

      <DataState
        query={query}
        empty={{ title: "No outreach activity yet" }}
        render={(data) => {
          const funnel = buildOutreachFunnel(data.leads_by_status);
          const complaintPct = data.complaint_rate_pct ?? 0;
          return (
            <>
              {complaintPct > 0.2 && (
                <Callout tone="danger" title="Approaching the auto-pause threshold">
                  Complaint rate at {complaintPct.toFixed(2)}% — campaigns auto-pause at 0.3%.
                </Callout>
              )}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <MetricCard
                  label="CAC (outreach)"
                  value={cacCents ?? Number.NaN}
                  format="currency"
                  loading={cacQuery.isPending}
                />
                <MetricCard label="Complaint rate" value={complaintPct} format="percent" />
              </div>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Funnel</CardTitle>
                </CardHeader>
                <CardContent>
                  {funnel.length > 0 ? (
                    <FunnelChart stages={funnel} />
                  ) : (
                    <EmptyState title="No funnel data yet" />
                  )}
                </CardContent>
              </Card>
            </>
          );
        }}
      />
    </div>
  );
}
