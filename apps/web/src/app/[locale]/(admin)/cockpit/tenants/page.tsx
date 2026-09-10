"use client";

import { formatCentsUSD } from "@heyloo/canonical-types";
import { DataState, DataTable, PageHeader, StatusBadge } from "@heyloo/ui";
import type { ColumnDef } from "@tanstack/react-table";
import { useRouter } from "@/i18n/navigation";
import { useAdminQuery } from "@/lib/hooks/use-admin-query";

interface TenantRow {
  id: string;
  name: string;
  vertical: string;
  plan_code: string;
  status: string;
  mrr_cents: number;
  margin_pct: number;
  created_at: string;
}

const columns: ColumnDef<TenantRow, unknown>[] = [
  { accessorKey: "name", header: "Business" },
  {
    accessorKey: "vertical",
    header: "Vertical",
    cell: ({ row }) => (
      <span className="capitalize">{row.original.vertical.replace(/_/g, " ")}</span>
    ),
  },
  { accessorKey: "plan_code", header: "Plan" },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <StatusBadge variant="tenant" value={row.original.status} />,
  },
  {
    accessorKey: "mrr_cents",
    header: "MRR",
    cell: ({ row }) => (
      <span className="tabular-nums">
        {row.original.mrr_cents != null ? formatCentsUSD(row.original.mrr_cents) : "—"}
      </span>
    ),
  },
  {
    accessorKey: "margin_pct",
    header: "Margin %",
    cell: ({ row }) => (
      <span className="tabular-nums">
        {row.original.margin_pct?.toFixed(1) ?? "—"}
        {row.original.margin_pct != null ? "%" : ""}
      </span>
    ),
  },
];

export default function TenantsListPage() {
  const router = useRouter();
  const query = useAdminQuery<{ rows: TenantRow[] }>("tenants", [], "admin-tenants");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tenants"
        description="Every customer on the platform — health, plan, and margin at a glance."
      />
      <DataState
        query={query}
        empty={{ title: "No tenants yet" }}
        render={(data) => (
          <DataTable
            columns={columns}
            data={data.rows}
            onRowClick={(row) => router.push(`/cockpit/tenants/${row.id}`)}
          />
        )}
      />
    </div>
  );
}
