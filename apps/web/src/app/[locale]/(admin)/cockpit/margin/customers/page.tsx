"use client";

import { formatCentsUSD } from "@heyloo/canonical-types";
import { DataState, DataTable, PageHeader, StatusBadge } from "@heyloo/ui";
import type { ColumnDef } from "@tanstack/react-table";
import { useRouter } from "@/i18n/navigation";
import { useAdminQuery } from "@/lib/hooks/use-admin-query";

interface TenantMarginRow {
  tenant_id: string;
  name: string;
  revenue_cents: number;
  cost_cents: number;
  margin_pct: number;
  health: "healthy" | "watch" | "negative";
  diagnosis_reason: string | null;
}

const columns: ColumnDef<TenantMarginRow, unknown>[] = [
  { accessorKey: "name", header: "Tenant" },
  {
    accessorKey: "revenue_cents",
    header: "Revenue",
    cell: ({ row }) => (
      <span className="tabular-nums">{formatCentsUSD(row.original.revenue_cents)}</span>
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
    accessorKey: "margin_pct",
    header: "Margin %",
    cell: ({ row }) => (
      <span className="tabular-nums">
        {row.original.margin_pct != null ? `${row.original.margin_pct.toFixed(1)}%` : "—"}
      </span>
    ),
  },
  {
    accessorKey: "health",
    header: "Health",
    cell: ({ row }) => <StatusBadge variant="margin" value={row.original.health} />,
  },
  {
    accessorKey: "diagnosis_reason",
    header: "Diagnosis",
    cell: ({ row }) => row.original.diagnosis_reason ?? "—",
  },
];

export default function PerCustomerMarginPage() {
  const router = useRouter();
  const query = useAdminQuery<{ rows: TenantMarginRow[] }>(
    "per-customer-margin",
    [],
    "admin-cockpit/per-customer-margin",
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Margin by customer"
        description="Revenue, cost, and margin health for every active customer."
      />
      <DataState
        query={query}
        empty={{ title: "No customer margin data yet" }}
        render={(data) => (
          <DataTable
            columns={columns}
            data={data.rows}
            onRowClick={(row) => router.push(`/cockpit/margin/customers/${row.tenant_id}`)}
            emptyState={{ title: "No customer margin data yet" }}
          />
        )}
      />
    </div>
  );
}
