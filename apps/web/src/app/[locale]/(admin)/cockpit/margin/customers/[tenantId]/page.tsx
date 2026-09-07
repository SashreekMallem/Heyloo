"use client";

import { formatCentsUSD } from "@heyloo/canonical-types";
import { Card, CardContent, CardHeader, CardTitle, DataState, DataTable } from "@heyloo/ui";
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
  { accessorKey: "call_id", header: "Call" },
  {
    accessorKey: "cost_cents",
    header: "Cost",
    cell: ({ row }) => formatCentsUSD(row.original.cost_cents),
  },
  {
    accessorKey: "billed_cents",
    header: "Billed",
    cell: ({ row }) => formatCentsUSD(row.original.billed_cents),
  },
  {
    accessorKey: "delta_cents",
    header: "Delta",
    cell: ({ row }) => formatCentsUSD(row.original.delta_cents),
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
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Tenant margin detail</h1>
      <DataState
        query={query}
        empty={{ title: "No per-call data for this tenant" }}
        render={(data) => (
          <>
            {data.suggestedAction && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Suggested action</CardTitle>
                </CardHeader>
                <CardContent>{data.suggestedAction}</CardContent>
              </Card>
            )}
            <DataTable columns={columns} data={data.calls} />
          </>
        )}
      />
    </div>
  );
}
