"use client";

import { formatCentsUSD } from "@heyloo/canonical-types";
import { Badge, type BadgeProps, DataTable, EmptyState } from "@heyloo/ui";
import type { ColumnDef } from "@tanstack/react-table";

export interface PayoutRow {
  id: string;
  total_cents: number;
  period: string;
  status: string;
  created_at: string;
}

const STATUS_VARIANT: Record<string, BadgeProps["variant"]> = {
  sent: "success",
  paid: "success",
  pending: "outline",
  processing: "secondary",
  failed: "destructive",
};

const columns: ColumnDef<PayoutRow, unknown>[] = [
  {
    accessorKey: "period",
    header: "Period",
    cell: ({ row }) => {
      const date = new Date(row.original.period);
      return Number.isNaN(date.getTime())
        ? "—"
        : date.toLocaleDateString(undefined, { year: "numeric", month: "long" });
    },
  },
  {
    accessorKey: "total_cents",
    header: "Amount",
    cell: ({ row }) => (
      <span className="tabular-nums font-medium">{formatCentsUSD(row.original.total_cents)}</span>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <Badge variant={STATUS_VARIANT[row.original.status] ?? "outline"} className="capitalize">
        {row.original.status}
      </Badge>
    ),
  },
];

export function PayoutsTableClient({ payouts }: { payouts: PayoutRow[] }) {
  if (payouts.length === 0) {
    return (
      <EmptyState
        title="No payouts yet"
        description="You'll see them here once a referral qualifies."
      />
    );
  }
  return <DataTable columns={columns} data={payouts} />;
}
