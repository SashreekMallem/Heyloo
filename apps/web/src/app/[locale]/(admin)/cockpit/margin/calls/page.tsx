"use client";

import { formatCentsUSD } from "@heyloo/canonical-types";
import { DataState, DataTable } from "@heyloo/ui";
import type { ColumnDef } from "@tanstack/react-table";
import { useAdminQuery } from "@/lib/hooks/use-admin-query";

interface CallCostRow {
  call_id: string;
  tenant_name: string;
  duration_seconds: number;
  cost_cents: number;
  billed_cents: number;
  delta_cents: number;
}

const columns: ColumnDef<CallCostRow, unknown>[] = [
  { accessorKey: "tenant_name", header: "Tenant" },
  {
    accessorKey: "duration_seconds",
    header: "Duration",
    cell: ({ row }) => `${Math.round(row.original.duration_seconds / 60)}m`,
  },
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

export default function PerCallCostPage() {
  const query = useAdminQuery<{ rows: CallCostRow[] }>(
    "per-call-cost",
    [],
    "admin-cockpit/per-call-cost",
  );
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Cost vs. billed by call</h1>
      <DataState
        query={query}
        empty={{ title: "No call cost data yet" }}
        render={(data) => <DataTable columns={columns} data={data.rows} />}
      />
    </div>
  );
}
