"use client";

import { formatCentsUSD } from "@heyloo/canonical-types";
import { DataState, DataTable, StatusBadge } from "@heyloo/ui";
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
  { accessorKey: "vertical", header: "Vertical" },
  { accessorKey: "plan_code", header: "Plan" },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <StatusBadge variant="tenant" value={row.original.status} />,
  },
  {
    accessorKey: "mrr_cents",
    header: "MRR",
    cell: ({ row }) => formatCentsUSD(row.original.mrr_cents),
  },
  {
    accessorKey: "margin_pct",
    header: "Margin %",
    cell: ({ row }) => `${row.original.margin_pct.toFixed(1)}%`,
  },
];

export default function TenantsListPage() {
  const router = useRouter();
  const query = useAdminQuery<{ rows: TenantRow[] }>("tenants", [], "admin-tenants");

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Tenants</h1>
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
