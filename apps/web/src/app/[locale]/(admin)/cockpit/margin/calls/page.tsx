"use client";

import { formatCentsUSD } from "@heyloo/canonical-types";
import { cn, DataState, DataTable, PageHeader } from "@heyloo/ui";
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
    cell: ({ row }) => (
      <span className="tabular-nums">{Math.round(row.original.duration_seconds / 60)}m</span>
    ),
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
      <span
        className={cn(
          "tabular-nums font-medium",
          row.original.delta_cents < 0 ? "text-destructive" : "text-success",
        )}
      >
        {formatCentsUSD(row.original.delta_cents)}
      </span>
    ),
  },
];

export default function PerCallCostPage() {
  const query = useAdminQuery<{ rows: CallCostRow[] }>(
    "per-call-cost",
    [],
    "admin-cockpit/per-call-cost",
  );
  return (
    <div className="space-y-6">
      <PageHeader
        title="Cost vs. billed by call"
        description="Actual provider cost against what the customer was billed, call by call."
      />
      <DataState
        query={query}
        empty={{ title: "No call cost data yet" }}
        render={(data) => (
          <DataTable
            columns={columns}
            data={data.rows}
            emptyState={{ title: "No call cost data yet" }}
          />
        )}
      />
    </div>
  );
}
