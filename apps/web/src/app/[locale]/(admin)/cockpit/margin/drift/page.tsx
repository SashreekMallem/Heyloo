"use client";

import { DataState, DriftLineChart, type DriftMarker, type DriftPoint } from "@heyloo/ui";
import { useAdminQuery } from "@/lib/hooks/use-admin-query";

export default function RepricingDriftPage() {
  const query = useAdminQuery<{ points: DriftPoint[]; markers: DriftMarker[] }>(
    "repricing-drift",
    [],
    "admin-cockpit/repricing-drift",
  );
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Provider repricing drift</h1>
      <DataState
        query={query}
        empty={{ title: "No drift data yet" }}
        render={(data) => <DriftLineChart data={data.points} markers={data.markers} />}
      />
    </div>
  );
}
