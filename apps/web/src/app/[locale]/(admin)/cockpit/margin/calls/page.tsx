"use client";

import { formatCentsUSD } from "@heyloo/canonical-types";
import { cn, DataState, DataTable, PageHeader } from "@heyloo/ui";
import type { ColumnDef } from "@tanstack/react-table";
import { useMarginControls } from "@/components/admin/margin-controls";
import { useAdminQuery } from "@/lib/hooks/use-admin-query";

interface CallCostRow {
  call_id: string;
  tenant_name: string;
  started_at: string;
  duration_seconds: number;
  /** null = the provider never reported a cost for this call (unknown, not zero). */
  cost_cents: number | null;
  cost_source: string | null;
  billed_cents: number | null;
  delta_cents: number | null;
  is_test: boolean;
}

function money(cents: number | null): string {
  return cents === null ? "—" : formatCentsUSD(cents);
}

const columns: ColumnDef<CallCostRow, unknown>[] = [
  { accessorKey: "tenant_name", header: "Tenant" },
  {
    accessorKey: "started_at",
    header: "Started",
    cell: ({ row }) => new Date(row.original.started_at).toLocaleString(),
  },
  {
    accessorKey: "duration_seconds",
    header: "Duration",
    cell: ({ row }) => {
      const s = row.original.duration_seconds;
      return <span className="tabular-nums">{s >= 60 ? `${(s / 60).toFixed(1)}m` : `${s}s`}</span>;
    },
  },
  {
    accessorKey: "cost_cents",
    header: "Cost",
    cell: ({ row }) => <span className="tabular-nums">{money(row.original.cost_cents)}</span>,
  },
  {
    accessorKey: "billed_cents",
    header: "Billed (allowance rate)",
    cell: ({ row }) => <span className="tabular-nums">{money(row.original.billed_cents)}</span>,
  },
  {
    accessorKey: "delta_cents",
    header: "Delta",
    cell: ({ row }) => (
      <span
        className={cn(
          "tabular-nums font-medium",
          row.original.delta_cents !== null && row.original.delta_cents < 0
            ? "text-destructive"
            : "text-success",
        )}
      >
        {money(row.original.delta_cents)}
      </span>
    ),
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

export default function PerCallCostPage() {
  const { includeTest, qs, controls } = useMarginControls();
  const query = useAdminQuery<{ rows: CallCostRow[] }>(
    "per-call-cost",
    [includeTest],
    `admin-cockpit/per-call-cost${qs}`,
  );
  return (
    <div className="space-y-6">
      <PageHeader
        title="Cost vs. billed by call"
        description="Provider-reported cost against the plan's in-allowance price, call by call (newest 200)."
        actions={controls}
      />
      <DataState
        query={query}
        empty={{
          title: "No call cost data yet",
          isEmpty: (data) => (data?.rows?.length ?? 0) === 0,
        }}
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
