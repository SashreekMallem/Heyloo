"use client";

import { DataState, PageHeader } from "@heyloo/ui";
import { LatencyPercentileChart, type LatencyPoint } from "@heyloo/ui/charts";
import { useAdminQuery } from "@/lib/hooks/use-admin-query";

export default function BottlenecksPage() {
  const query = useAdminQuery<{ byTool: Record<string, LatencyPoint[]> }>(
    "bottleneck",
    [],
    "admin-cockpit/bottleneck",
  );
  return (
    <div className="space-y-6">
      <PageHeader
        title="Tool latency & error rate"
        description="p50/p95/p99 latency per voice tool, so a slow tool call never becomes a customer-visible pause."
      />
      <DataState
        query={query}
        empty={{
          title: "No latency data yet",
          isEmpty: (data) => Object.keys(data?.byTool ?? {}).length === 0,
        }}
        render={(data) => (
          <div className="space-y-6">
            {Object.entries(data.byTool ?? {}).map(([tool, points]) => (
              <div key={tool} className="rounded-lg border border-border p-4 shadow-xs">
                <h2 className="mb-2 font-mono text-small font-medium">{tool}</h2>
                <LatencyPercentileChart data={points} />
              </div>
            ))}
          </div>
        )}
      />
    </div>
  );
}
