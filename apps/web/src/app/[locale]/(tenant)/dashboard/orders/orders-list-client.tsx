"use client";

import { formatCentsUSD } from "@heyloo/canonical-types";
import { Badge, DataState, DataTable, PageHeader } from "@heyloo/ui";
import type { ColumnDef } from "@tanstack/react-table";
import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTenantQuery } from "@/lib/hooks/use-tenant-query";
import { supabaseBrowserClient } from "@/lib/supabase/browser";

interface OrderRow {
  id: string;
  createdAt: string;
  status: string;
  totalCents: number;
  fulfillmentType: string;
  customerName: string | null;
  paymentStatus: string | null;
}

const PAGE_SIZE = 25;

const ORDER_STATUSES = [
  "received",
  "confirmed",
  "preparing",
  "ready",
  "completed",
  "cancelled",
] as const;

const ORDER_STATUS_VARIANT: Record<
  string,
  "outline" | "secondary" | "success" | "destructive" | "warning"
> = {
  received: "outline",
  confirmed: "secondary",
  preparing: "secondary",
  ready: "warning",
  completed: "success",
  cancelled: "destructive",
};

const PAYMENT_STATUS_VARIANT: Record<string, "outline" | "secondary" | "success" | "destructive"> =
  {
    pending: "outline",
    sent: "secondary",
    paid: "success",
    expired: "destructive",
    cancelled: "destructive",
  };

const columns: ColumnDef<OrderRow, unknown>[] = [
  {
    accessorKey: "createdAt",
    header: "Time",
    cell: ({ row }) => new Date(row.original.createdAt).toLocaleString(),
  },
  {
    accessorKey: "customerName",
    header: "Customer",
    cell: ({ row }) => row.original.customerName ?? "Unknown",
  },
  {
    accessorKey: "fulfillmentType",
    header: "Fulfillment",
    cell: ({ row }) => row.original.fulfillmentType,
  },
  {
    accessorKey: "totalCents",
    header: "Total",
    cell: ({ row }) => formatCentsUSD(row.original.totalCents),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <Badge variant={ORDER_STATUS_VARIANT[row.original.status] ?? "outline"}>
        {row.original.status}
      </Badge>
    ),
  },
  {
    accessorKey: "paymentStatus",
    header: "Payment",
    cell: ({ row }) =>
      row.original.paymentStatus ? (
        <Badge variant={PAYMENT_STATUS_VARIANT[row.original.paymentStatus] ?? "outline"}>
          {row.original.paymentStatus}
        </Badge>
      ) : (
        "—"
      ),
  },
];

export function OrdersListClient({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState<string>("all");

  const query = useTenantQuery(tenantId, "orders", ["list", page, status], async () => {
    let q = supabaseBrowserClient
      .from("orders")
      .select("id, created_at, status, total_cents, fulfillment_type, customer_id", {
        count: "exact",
      })
      .eq("tenant_id", tenantId)
      // PUBLISH-1 (docs/BUILD_NOTES.md, ONBOARD-1's own flagged
      // inconsistency): never show a Retell batch-test/simulator order on
      // the tenant's real orders list — mirrors bookings/page.tsx's own
      // `.eq("is_test", false)` (CALL-6).
      .eq("is_test", false)
      .order("created_at", { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

    if (status !== "all") {
      q = q.eq("status", status as (typeof ORDER_STATUSES)[number]);
    }

    const { data: orders, count } = await q;

    const customerIds = [
      ...new Set((orders ?? []).map((o) => o.customer_id).filter((id): id is string => !!id)),
    ];
    const orderIds = (orders ?? []).map((o) => o.id);

    const [{ data: customers }, { data: paymentLinks }] = await Promise.all([
      customerIds.length
        ? supabaseBrowserClient.from("customers").select("id, name").in("id", customerIds)
        : Promise.resolve({ data: [] as { id: string; name: string | null }[] }),
      orderIds.length
        ? supabaseBrowserClient
            .from("payment_links")
            .select("order_id, status, created_at")
            .eq("tenant_id", tenantId)
            .in("order_id", orderIds)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [] as { order_id: string | null; status: string }[] }),
    ]);

    const nameById = new Map((customers ?? []).map((c) => [c.id, c.name]));
    const paymentByOrderId = new Map<string, string>();
    for (const link of paymentLinks ?? []) {
      if (link.order_id && !paymentByOrderId.has(link.order_id)) {
        paymentByOrderId.set(link.order_id, link.status);
      }
    }

    return {
      rows: (orders ?? []).map(
        (o): OrderRow => ({
          id: o.id,
          createdAt: o.created_at,
          status: o.status,
          totalCents: o.total_cents,
          fulfillmentType: o.fulfillment_type,
          customerName: (o.customer_id && nameById.get(o.customer_id)) ?? null,
          paymentStatus: paymentByOrderId.get(o.id) ?? null,
        }),
      ),
      pageCount: Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE)),
    };
  });

  return (
    <div className="space-y-4">
      <PageHeader title="Orders" description="Orders your AI takes over the phone." />
      <DataState
        query={query}
        empty={{
          title: "No orders yet",
          description: "Orders your AI takes over the phone will show up here.",
        }}
        render={(data) => (
          <DataTable
            columns={columns}
            data={data.rows}
            pageCount={data.pageCount}
            pageIndex={page}
            onPageChange={setPage}
            onRowClick={(row) => router.push(`/dashboard/orders/${row.id}`)}
            filters={[
              {
                label: "Status",
                value: status,
                onChange: setStatus,
                options: [
                  { label: "All", value: "all" },
                  ...ORDER_STATUSES.map((s) => ({ label: s, value: s })),
                ],
              },
            ]}
            renderMobileCard={(row) => (
              <div className="rounded-md border border-border p-3">
                <p className="text-sm font-medium">{row.customerName ?? "Unknown"}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(row.createdAt).toLocaleString()}
                </p>
                <div className="mt-1 flex items-center gap-2">
                  <Badge variant={ORDER_STATUS_VARIANT[row.status] ?? "outline"}>
                    {row.status}
                  </Badge>
                  <span className="text-sm">{formatCentsUSD(row.totalCents)}</span>
                </div>
              </div>
            )}
          />
        )}
      />
    </div>
  );
}
