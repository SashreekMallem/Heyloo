"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataState,
  FunnelChart,
  MetricCard,
} from "@heyloo/ui";
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Outreach</h1>
        <nav className="flex gap-4 text-sm">
          <Link href="/cockpit/outreach/campaigns" className="underline">
            Campaigns
          </Link>
          <Link href="/cockpit/outreach/leads" className="underline">
            Leads
          </Link>
          <Link href="/cockpit/outreach/replies" className="underline">
            Replies
          </Link>
        </nav>
      </div>

      <DataState
        query={query}
        empty={{ title: "No outreach activity yet" }}
        render={(data) => (
          <>
            {data.complaintRatePct > 0.2 && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                Complaint rate at {data.complaintRatePct.toFixed(2)}% — approaching the 0.3%
                auto-pause threshold.
              </div>
            )}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <MetricCard label="CAC (outreach)" value={data.cacSummaryCents} format="currency" />
            </div>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Funnel</CardTitle>
              </CardHeader>
              <CardContent>
                <FunnelChart stages={data.funnel} />
              </CardContent>
            </Card>
          </>
        )}
      />
    </div>
  );
}
