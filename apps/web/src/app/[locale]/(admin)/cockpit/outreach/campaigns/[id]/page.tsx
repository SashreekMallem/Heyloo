"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataState,
  EmptyState,
  FunnelChart,
  LeadTable,
  PageHeader,
  StatusBadge,
} from "@heyloo/ui";
import { use } from "react";
import { useAdminQuery } from "@/lib/hooks/use-admin-query";

interface CampaignDetail {
  name: string;
  status: string;
  funnel: { label: string; count: number }[];
  leads: Parameters<typeof LeadTable>[0]["data"];
}

export default function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const query = useAdminQuery<CampaignDetail>(
    "campaign-detail",
    [id],
    `admin-outreach/campaigns/${id}`,
  );

  return (
    <div className="space-y-6">
      <DataState
        query={query}
        empty={{ title: "Campaign not found" }}
        render={(campaign) => (
          <div className="space-y-6">
            <PageHeader
              title={campaign.name || "Unnamed campaign"}
              description={<StatusBadge variant="tenant" value={campaign.status} />}
            />
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Funnel</CardTitle>
              </CardHeader>
              <CardContent>
                {campaign.funnel && campaign.funnel.length > 0 ? (
                  <FunnelChart stages={campaign.funnel} />
                ) : (
                  <EmptyState title="No funnel data yet" />
                )}
              </CardContent>
            </Card>
            <LeadTable data={campaign.leads} emptyState={{ title: "No leads yet" }} />
          </div>
        )}
      />
    </div>
  );
}
