"use client";

import { DataState, DataTable, StatusBadge, Tabs, TabsList, TabsTrigger } from "@heyloo/ui";
import type { ColumnDef } from "@tanstack/react-table";
import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { useAdminQuery } from "@/lib/hooks/use-admin-query";

interface TicketRow {
  id: string;
  tenant_name: string;
  subject: string;
  priority: string;
  status: string;
  updated_at: string;
}

const columns: ColumnDef<TicketRow, unknown>[] = [
  { accessorKey: "tenant_name", header: "Tenant" },
  { accessorKey: "subject", header: "Subject" },
  { accessorKey: "priority", header: "Priority" },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <StatusBadge variant="ticket" value={row.original.status} />,
  },
  {
    accessorKey: "updated_at",
    header: "Last updated",
    cell: ({ row }) => new Date(row.original.updated_at).toLocaleString(),
  },
];

const STATUS_FILTERS = ["all", "open", "pending", "resolved", "closed"] as const;

/** Admin cockpit ticket queue (Cluster H task brief item 3 — the tenant-side create/view flow already lives at `dashboard/support/**`). */
export default function AdminSupportQueuePage() {
  const router = useRouter();
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>("open");

  const query = useAdminQuery<{ rows: TicketRow[] }>(
    "support_requests",
    [status],
    `admin-support-requests${status === "all" ? "" : `?status=${status}`}`,
  );

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Support tickets</h1>
      <Tabs value={status} onValueChange={(v) => setStatus(v as (typeof STATUS_FILTERS)[number])}>
        <TabsList>
          {STATUS_FILTERS.map((s) => (
            <TabsTrigger key={s} value={s} className="capitalize">
              {s}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <DataState
        query={query}
        empty={{ title: "No tickets", description: "Nothing matches this filter." }}
        render={(data) => (
          <DataTable
            columns={columns}
            data={data.rows}
            onRowClick={(row) => router.push(`/cockpit/support/${row.id}`)}
            renderMobileCard={(row) => (
              <div className="rounded-lg border border-border p-3">
                <p className="text-sm font-medium">{row.tenant_name}</p>
                <p className="text-sm text-muted-foreground">{row.subject}</p>
                <StatusBadge variant="ticket" value={row.status} className="mt-1" />
              </div>
            )}
          />
        )}
      />
    </div>
  );
}
