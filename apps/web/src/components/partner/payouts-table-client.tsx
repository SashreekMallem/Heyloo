"use client";

import { formatCentsUSD } from "@heyloo/canonical-types";
import { DataTable, EmptyState } from "@heyloo/ui";
import type { ColumnDef } from "@tanstack/react-table";

interface PayoutRow {
  id: string;
  amount_cents: number;
  method: string;
  status: string;
  created_at: string;
}

const columns: ColumnDef<PayoutRow, unknown>[] = [
  {
    accessorKey: "created_at",
    header: "Date",
    cell: ({ row }) => new Date(row.original.created_at).toLocaleDateString(),
  },
  {
    accessorKey: "amount_cents",
    header: "Amount",
    cell: ({ row }) => formatCentsUSD(row.original.amount_cents),
  },
  { accessorKey: "method", header: "Method" },
  { accessorKey: "status", header: "Status" },
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
