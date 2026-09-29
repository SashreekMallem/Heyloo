"use client";

import { formatCentsUSD } from "@heyloo/canonical-types";
import { Callout, DataState, PageHeader } from "@heyloo/ui";
import { MarginWaterfall, type WaterfallSegment } from "@heyloo/ui/charts";
import { useMarginControls } from "@/components/admin/margin-controls";
import { useAdminQuery } from "@/lib/hooks/use-admin-query";

interface WaterfallResponse {
  segments: WaterfallSegment[];
  totals?: { pending_revenue_cents: number };
  window?: { start: string; end: string };
  include_test?: boolean;
}

export default function MarginWaterfallPage() {
  const { period, includeTest, qs, controls } = useMarginControls({ withPeriod: true });
  const query = useAdminQuery<WaterfallResponse>(
    "waterfall",
    [period, includeTest],
    `admin-cockpit/waterfall${qs}`,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Margin waterfall"
        description="Paid revenue down to net margin, cost component by cost component, for the selected period."
        actions={controls}
      />
      <DataState
        query={query}
        empty={{
          title: "No margin data for this period",
          isEmpty: (data) => (data?.segments?.length ?? 0) === 0,
        }}
        errorEventId={undefined}
        render={(data) => (
          <div className="space-y-4">
            <MarginWaterfall segments={data.segments} />
            <p className="text-small text-muted-foreground">
              Revenue is Stripe-collected (paid) invoices for the billing period; invoices are
              billed in arrears, so the current month shows no revenue until it is invoiced and
              paid.
              {includeTest
                ? " Test tenants and test calls are included."
                : " Test tenants and test calls are excluded."}
            </p>
            {(data.totals?.pending_revenue_cents ?? 0) > 0 && (
              <Callout tone="info">
                {formatCentsUSD(data.totals?.pending_revenue_cents ?? 0)} invoiced for this period
                but not yet paid is not counted as revenue.
              </Callout>
            )}
          </div>
        )}
      />
    </div>
  );
}
