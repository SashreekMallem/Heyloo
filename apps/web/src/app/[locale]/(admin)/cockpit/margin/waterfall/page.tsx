"use client";

import { Button, DataState, MarginWaterfall, PageHeader, type WaterfallSegment } from "@heyloo/ui";
import { useState } from "react";
import { useAdminQuery } from "@/lib/hooks/use-admin-query";

export default function MarginWaterfallPage() {
  const [period, setPeriod] = useState<"mtd" | "quarter">("mtd");
  const query = useAdminQuery<{ segments: WaterfallSegment[] }>(
    "waterfall",
    [period],
    `admin-cockpit/waterfall?period=${period}`,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Margin waterfall"
        description="Revenue down to net margin, segment by segment, for the selected period."
        actions={
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={period === "mtd" ? "default" : "outline"}
              onClick={() => setPeriod("mtd")}
            >
              MTD
            </Button>
            <Button
              size="sm"
              variant={period === "quarter" ? "default" : "outline"}
              onClick={() => setPeriod("quarter")}
            >
              Quarter
            </Button>
          </div>
        }
      />
      <DataState
        query={query}
        empty={{ title: "No margin data for this period" }}
        errorEventId={undefined}
        render={(data) => <MarginWaterfall segments={data.segments} />}
      />
    </div>
  );
}
