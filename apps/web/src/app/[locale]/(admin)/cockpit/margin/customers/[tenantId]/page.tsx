"use client";

import { formatCentsUSD } from "@heyloo/canonical-types";
import { Callout, DataState, DataTable, MetricCard, PageHeader } from "@heyloo/ui";
import type { ColumnDef } from "@tanstack/react-table";
import { use } from "react";
import { useMarginControls } from "@/components/admin/margin-controls";
import { useAdminQuery } from "@/lib/hooks/use-admin-query";

interface CallCostRow {
  call_id: string;
  started_at: string;
  duration_seconds: number;
  /** null = the provider never reported a cost for this call (unknown, not zero). */
  cost_cents: number | null;
  billed_cents: number | null;
  delta_cents: number | null;
  cost_source: string | null;
  is_test: boolean;
}

interface TenantMarginDetail {
  /** Whether test calls are in the numbers below (a test tenant always shows its own). */
  include_test?: boolean;
  tenant: { id: string; name: string; vertical: string; is_test: boolean };
  summary: {
    revenue_cents: number;
    cost_cents: number;
    margin_cents: number;
    margin_pct: number | null;
    health: string;
    diagnosis_reason: string | null;
  };
  calls: CallCostRow[];
  suggestedAction: string | null;
}

function money(cents: number | null): string {
  return cents === null ? "—" : formatCentsUSD(cents);
}

const columns: ColumnDef<CallCostRow, unknown>[] = [
  {
    accessorKey: "call_id",
    header: "Call",
    cell: ({ row }) => <span className="font-mono text-small">{row.original.call_id}</span>,
  },
  {
    accessorKey: "started_at",
    header: "Started",
    cell: ({ row }) => new Date(row.original.started_at).toLocaleString(),
  },
  {
    accessorKey: "cost_cents",
    header: "Cost",
    cell: ({ row }) => <span className="tabular-nums">{money(row.original.cost_cents)}</span>,
  },
  {
    accessorKey: "billed_cents",
    header: "Billed",
    cell: ({ row }) => <span className="tabular-nums">{money(row.original.billed_cents)}</span>,
  },
  {
    accessorKey: "delta_cents",
    header: "Delta",
    cell: ({ row }) => <span className="tabular-nums">{money(row.original.delta_cents)}</span>,
  },
  {
    accessorKey: "cost_source",
    header: "Cost source",
    cell: ({ row }) => (
      <span className="text-small text-muted-foreground">
        {row.original.cost_source ?? "unknown"}
        {row.original.is_test ? " · test" : ""}
      </span>
    ),
  },
];

export default function TenantMarginDetailPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = use(params);
  // COCKPIT-F13: the include-test choice made on the customer list carries over to
  // this drill-down (shared through the margin layout), so a customer's cost here
  // matches the list; the switch is shown so it can be changed in place.
  const { period, includeTest, qs, controls } = useMarginControls({ withPeriod: true });
  const query = useAdminQuery<TenantMarginDetail>(
    "per-customer-margin-detail",
    [tenantId, period, includeTest],
    `admin-cockpit/per-customer-margin/${tenantId}${qs}`,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={query.data?.tenant.name ?? "Tenant margin detail"}
        description={`Per-call cost vs. billed for this customer. ${
          query.data?.include_test ? "Includes test calls." : "Real calls only."
        }`}
        actions={controls}
      />
      <DataState
        query={query}
        empty={{
          title: "Tenant not found",
          isEmpty: (data) => !data?.summary,
        }}
        render={(data) => (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <MetricCard
                label="Paid revenue"
                value={data.summary.revenue_cents}
                format="currency"
              />
              <MetricCard label="Cost" value={data.summary.cost_cents} format="currency" />
              <MetricCard label="Margin" value={data.summary.margin_cents} format="currency" />
              {/* No paid revenue -> no margin % (never a fabricated 0%). */}
              {data.summary.margin_pct !== null && (
                <MetricCard label="Margin %" value={data.summary.margin_pct} format="percent" />
              )}
            </div>
            {data.summary.diagnosis_reason && (
              <Callout tone="warning" title="Diagnosis">
                {data.summary.diagnosis_reason}
              </Callout>
            )}
            {data.suggestedAction && (
              <Callout tone="info" title="Suggested action">
                {data.suggestedAction}
              </Callout>
            )}
            <DataTable columns={columns} data={data.calls} />
          </>
        )}
      />
    </div>
  );
}
