"use client";

import { DataState, LatencyPercentileChart, type LatencyPoint } from "@heyloo/ui";
import { useAdminQuery } from "@/lib/hooks/use-admin-query";

export default function BottlenecksPage() {
  const query = useAdminQuery<{ byTool: Record<string, LatencyPoint[]> }>(
    "bottleneck",
    [],
    "admin-cockpit/bottleneck",
  );
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Tool latency & error rate</h1>
      <DataState
        query={query}
        empty={{ title: "No latency data yet" }}
        render={(data) => (
          <div className="space-y-6">
            {Object.entries(data.byTool).map(([tool, points]) => (
              <div key={tool} className="rounded-lg border border-border p-4">
                <h2 className="mb-2 text-sm font-medium">{tool}</h2>
                <LatencyPercentileChart data={points} />
              </div>
            ))}
          </div>
        )}
      />
    </div>
  );
}
