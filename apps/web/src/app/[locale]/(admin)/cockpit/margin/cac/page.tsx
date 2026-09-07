"use client";

import { DataState, TrendChart } from "@heyloo/ui";
import { useAdminQuery } from "@/lib/hooks/use-admin-query";

interface CacPoint {
  label: string;
  value: number;
}

export default function CacPage() {
  const query = useAdminQuery<{ byChannel: Record<string, CacPoint[]> }>("cac", [], "admin-cac");
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Customer acquisition cost</h1>
      <DataState
        query={query}
        empty={{ title: "No CAC data yet" }}
        render={(data) => (
          <div className="grid gap-6 sm:grid-cols-2">
            {Object.entries(data.byChannel).map(([channel, points]) => (
              <div key={channel} className="rounded-lg border border-border p-4">
                <h2 className="mb-2 text-sm font-medium capitalize">
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
