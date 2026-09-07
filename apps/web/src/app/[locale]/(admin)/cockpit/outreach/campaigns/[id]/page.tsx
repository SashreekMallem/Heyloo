"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataState,
  FunnelChart,
  LeadTable,
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
    <div className="space-y-4">
      <DataState
        query={query}
        empty={{ title: "Campaign not found" }}
        render={(campaign) => (
          <>
            <h1 className="text-xl font-semibold">{campaign.name}</h1>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Funnel</CardTitle>
              </CardHeader>
              <CardContent>
                <FunnelChart stages={campaign.funnel} />
              </CardContent>
            </Card>
            <LeadTable data={campaign.leads} emptyState={{ title: "No leads yet" }} />
          </>
        )}
      />
    </div>
  );
}
