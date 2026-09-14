"use client";

import { DataState, PageHeader } from "@heyloo/ui";
import { TrendChart } from "@heyloo/ui/charts";
import { useAdminQuery } from "@/lib/hooks/use-admin-query";

interface CacPoint {
  label: string;
  value: number;
}

export default function CacPage() {
  const query = useAdminQuery<{ byChannel: Record<string, CacPoint[]> }>("cac", [], "admin-cac");
  return (
    <div className="space-y-6">
      <PageHeader
        title="Customer acquisition cost"
        description="Blended CAC by outreach channel, trended over time."
      />
      <DataState
        query={query}
        empty={{
          title: "No CAC data yet",
          isEmpty: (data) => Object.keys(data?.byChannel ?? {}).length === 0,
        }}
        render={(data) => (
          <div className="grid gap-6 sm:grid-cols-2">
            {Object.entries(data.byChannel ?? {}).map(([channel, points]) => (
              <div key={channel} className="rounded-lg border border-border p-4 shadow-xs">
                <h2 className="mb-2 text-small font-medium capitalize">
                  {channel.replace(/_/g, " ")}
                </h2>
                <TrendChart data={points} />
              </div>
            ))}
          </div>
        )}
      />
    </div>
  );
}
