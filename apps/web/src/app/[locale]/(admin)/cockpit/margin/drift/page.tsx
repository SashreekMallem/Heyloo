"use client";

import {
  DataState,
  DriftLineChart,
  type DriftMarker,
  type DriftPoint,
  PageHeader,
} from "@heyloo/ui";
import { useAdminQuery } from "@/lib/hooks/use-admin-query";

export default function RepricingDriftPage() {
  const query = useAdminQuery<{ points: DriftPoint[]; markers: DriftMarker[] }>(
    "repricing-drift",
    [],
    "admin-cockpit/repricing-drift",
  );
  return (
    <div className="space-y-6">
      <PageHeader
        title="Provider repricing drift"
        description="Underlying provider rate changes plotted against our own price cards over time."
      />
      <DataState
        query={query}
        empty={{
          title: "No drift data yet",
          isEmpty: (data) => (data?.points?.length ?? 0) === 0,
        }}
        render={(data) => <DriftLineChart data={data.points} markers={data.markers} />}
      />
    </div>
  );
}
