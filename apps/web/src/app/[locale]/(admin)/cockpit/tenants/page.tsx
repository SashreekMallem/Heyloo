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
  plan_code?: string | null;
  status: string;
  mrr_cents?: number | null;
  margin_pct?: number | null;
  created_at: string;
}

// The `admin` edge function's list route responds `{ tenants: [...] }`
// (`supabase/functions/admin/handler.ts`'s `handleTenants`), not `{ rows }`
// — reading `data.rows` unguarded left this table blank/crashing in
// production even though every other field on the row was fine (design
// review round 2, admin-partner cluster; see docs/BUILD_NOTES.md for the
// wider pattern across other cockpit list endpoints).
function tenantRows(data: { tenants?: TenantRow[]; rows?: TenantRow[] }): TenantRow[] {
  return data.tenants ?? data.rows ?? [];
}

function formatMargin(marginPct: number | null | undefined): string {
  return marginPct != null ? `${marginPct.toFixed(1)}%` : "—";
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
      <span className="tabular-nums">{formatMargin(row.original.margin_pct)}</span>
    ),
  },
];

export default function TenantsListPage() {
  const router = useRouter();
  const query = useAdminQuery<{ tenants?: TenantRow[]; rows?: TenantRow[] }>(
    "tenants",
    [],
    "admin-tenants",
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tenants"
        description="Every customer on the platform — health, plan, and margin at a glance."
      />
      <DataState
        query={query}
        empty={{ title: "No tenants yet", isEmpty: (d) => tenantRows(d).length === 0 }}
        render={(data) => (
          <DataTable
            columns={columns}
            data={tenantRows(data)}
            onRowClick={(row) => router.push(`/cockpit/tenants/${row.id}`)}
            renderMobileCard={(row) => (
              <div className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{row.name}</p>
                  <StatusBadge variant="tenant" value={row.status} />
                </div>
                <p className="text-xs capitalize text-muted-foreground">
                  {row.vertical.replace(/_/g, " ")}
                  {row.plan_code ? ` · ${row.plan_code}` : ""}
                </p>
                <div className="mt-2 flex items-center gap-4 text-xs tabular-nums">
                  <span>MRR {row.mrr_cents != null ? formatCentsUSD(row.mrr_cents) : "—"}</span>
                  <span>Margin {formatMargin(row.margin_pct)}</span>
                </div>
              </div>
            )}
          />
        )}
      />
    </div>
  );
}
