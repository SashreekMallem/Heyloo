"use client";

import { Callout, DataState, PageHeader } from "@heyloo/ui";
import { DriftLineChart, type DriftMarker, type DriftPoint } from "@heyloo/ui/charts";
import { useMarginControls } from "@/components/admin/margin-controls";
import { useAdminQuery } from "@/lib/hooks/use-admin-query";

interface DriftResponse {
  points: DriftPoint[];
  markers: DriftMarker[];
  threshold_pct?: number;
  baseline_cents_per_minute?: { voice: number; llm: number; telephony: number };
  baseline_configured?: boolean;
}

const perMin = (cents: number) => `$${(cents / 100).toFixed(4)}/min`;

export default function RepricingDriftPage() {
  const { includeTest, qs, controls } = useMarginControls();
  const query = useAdminQuery<DriftResponse>(
    "repricing-drift",
    [includeTest],
    `admin-cockpit/repricing-drift${qs}`,
  );
  return (
    <div className="space-y-6">
      <PageHeader
        title="Provider repricing drift"
        description="Per-minute voice, LLM and telephony rates Retell actually charged (last 90 days), against the price baseline."
        actions={controls}
      />
      <DataState
        query={query}
        empty={{
          title: "No drift data yet",
          isEmpty: (data) => (data?.points?.length ?? 0) === 0,
        }}
        render={(data) => (
          <div className="space-y-4">
            <DriftLineChart data={data.points} markers={data.markers} />
            {data.baseline_cents_per_minute && (
              <p className="text-small text-muted-foreground">
                Baseline ({data.baseline_configured ? "configured" : "Retell published prices"}):
                voice {perMin(data.baseline_cents_per_minute.voice)}, LLM{" "}
                {perMin(data.baseline_cents_per_minute.llm)}, telephony{" "}
                {perMin(data.baseline_cents_per_minute.telephony)}. A marker means the average for a
                day is more than {data.threshold_pct ?? 8}% away from baseline.
              </p>
            )}
            {data.markers.length > 0 && (
              <Callout tone="warning">
                {data.markers.length} marker{data.markers.length === 1 ? "" : "s"}: charged rates
                differ from the baseline by more than {data.threshold_pct ?? 8}%.
              </Callout>
            )}
          </div>
        )}
      />
    </div>
  );
}
