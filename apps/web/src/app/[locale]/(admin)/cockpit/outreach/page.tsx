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

interface OutreachOverview {
  funnel: { label: string; count: number }[];
  cacSummaryCents: number;
  complaintRatePct: number;
}

export default function OutreachOverviewPage() {
  const query = useAdminQuery<OutreachOverview>("outreach-overview", [], "admin-outreach/funnel");

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
        render={(data) => (
          <>
            {data.complaintRatePct > 0.2 && (
              <Callout tone="danger" title="Approaching the auto-pause threshold">
                Complaint rate at {data.complaintRatePct.toFixed(2)}% — campaigns auto-pause at
                0.3%.
              </Callout>
            )}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <MetricCard label="CAC (outreach)" value={data.cacSummaryCents} format="currency" />
            </div>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Funnel</CardTitle>
              </CardHeader>
              <CardContent>
                {data.funnel && data.funnel.length > 0 ? (
                  <FunnelChart stages={data.funnel} />
                ) : (
                  <EmptyState title="No funnel data yet" />
                )}
              </CardContent>
            </Card>
          </>
        )}
      />
    </div>
  );
}
