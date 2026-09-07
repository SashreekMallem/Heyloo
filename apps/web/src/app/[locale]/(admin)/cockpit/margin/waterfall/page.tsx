"use client";

import { Button, DataState, MarginWaterfall, type WaterfallSegment } from "@heyloo/ui";
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Margin waterfall</h1>
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
      </div>
      <DataState
        query={query}
        empty={{ title: "No margin data for this period" }}
        errorEventId={undefined}
        render={(data) => <MarginWaterfall segments={data.segments} />}
      />
    </div>
  );
}
