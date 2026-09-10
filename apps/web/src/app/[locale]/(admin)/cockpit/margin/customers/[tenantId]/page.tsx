"use client";

import { formatCentsUSD } from "@heyloo/canonical-types";
import { Callout, DataState, DataTable, PageHeader } from "@heyloo/ui";
import type { ColumnDef } from "@tanstack/react-table";
import { use } from "react";
import { useAdminQuery } from "@/lib/hooks/use-admin-query";

interface CallCostRow {
  call_id: string;
  cost_cents: number;
  billed_cents: number;
  delta_cents: number;
}

const columns: ColumnDef<CallCostRow, unknown>[] = [
  {
    accessorKey: "call_id",
    header: "Call",
    cell: ({ row }) => <span className="font-mono text-small">{row.original.call_id}</span>,
  },
  {
    accessorKey: "cost_cents",
    header: "Cost",
    cell: ({ row }) => (
      <span className="tabular-nums">{formatCentsUSD(row.original.cost_cents)}</span>
    ),
  },
  {
    accessorKey: "billed_cents",
    header: "Billed",
    cell: ({ row }) => (
      <span className="tabular-nums">{formatCentsUSD(row.original.billed_cents)}</span>
    ),
  },
  {
    accessorKey: "delta_cents",
    header: "Delta",
    cell: ({ row }) => (
      <span className="tabular-nums">{formatCentsUSD(row.original.delta_cents)}</span>
    ),
  },
];

export default function TenantMarginDetailPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = use(params);
  const query = useAdminQuery<{ calls: CallCostRow[]; suggestedAction: string | null }>(
    "per-customer-margin-detail",
    [tenantId],
    `admin-cockpit/per-customer-margin/${tenantId}`,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tenant margin detail"
        description="Per-call cost vs. billed for this customer."
      />
      <DataState
        query={query}
        empty={{
          title: "No per-call data for this tenant",
          isEmpty: (data) => (data?.calls?.length ?? 0) === 0,
        }}
        render={(data) => (
          <>
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
