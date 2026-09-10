"use client";

import { formatCentsUSD } from "@heyloo/canonical-types";
import { DataTable, EmptyState } from "@heyloo/ui";
import type { ColumnDef } from "@tanstack/react-table";

export interface PayoutRow {
  id: string;
  total_cents: number;
  period: string;
  status: string;
  created_at: string;
}

const columns: ColumnDef<PayoutRow, unknown>[] = [
  {
    accessorKey: "period",
    header: "Period",
    cell: ({ row }) =>
      new Date(row.original.period).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
      }),
  },
  {
    accessorKey: "total_cents",
    header: "Amount",
    cell: ({ row }) => formatCentsUSD(row.original.total_cents),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <span className="capitalize">{row.original.status}</span>,
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
