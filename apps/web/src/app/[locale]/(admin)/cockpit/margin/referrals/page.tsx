"use client";

import { formatCentsUSD } from "@heyloo/canonical-types";
import { DataState, DataTable } from "@heyloo/ui";
import type { ColumnDef } from "@tanstack/react-table";
import { useAdminQuery } from "@/lib/hooks/use-admin-query";

interface PartnerPnlRow {
  partner_id: string;
  partner_name: string;
  clicks: number;
  signups: number;
  qualified: number;
  paid: number;
  payouts_cents: number;
  revenue_cents: number;
}

const columns: ColumnDef<PartnerPnlRow, unknown>[] = [
  { accessorKey: "partner_name", header: "Partner" },
  { accessorKey: "clicks", header: "Clicks" },
  { accessorKey: "signups", header: "Signups" },
  { accessorKey: "qualified", header: "Qualified" },
  { accessorKey: "paid", header: "Paid" },
  {
    accessorKey: "payouts_cents",
    header: "Payouts",
    cell: ({ row }) => formatCentsUSD(row.original.payouts_cents),
  },
  {
    accessorKey: "revenue_cents",
    header: "Attributed revenue",
    cell: ({ row }) => formatCentsUSD(row.original.revenue_cents),
  },
];

export default function ReferralPnlPage() {
  const query = useAdminQuery<{ rows: PartnerPnlRow[] }>("referral-pnl", [], "admin-referrals");
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Referral P&L</h1>
      <DataState
        query={query}
        empty={{ title: "No referral activity yet" }}
        render={(data) => <DataTable columns={columns} data={data.rows} />}
      />
    </div>
  );
}
