"use client";

import { formatCentsUSD } from "@heyloo/canonical-types";
import { DataState, DataTable, PageHeader } from "@heyloo/ui";
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
  {
    accessorKey: "clicks",
    header: "Clicks",
    cell: ({ row }) => <span className="tabular-nums">{row.original.clicks}</span>,
  },
  {
    accessorKey: "signups",
    header: "Signups",
    cell: ({ row }) => <span className="tabular-nums">{row.original.signups}</span>,
  },
  {
    accessorKey: "qualified",
    header: "Qualified",
    cell: ({ row }) => <span className="tabular-nums">{row.original.qualified}</span>,
  },
  {
    accessorKey: "paid",
    header: "Paid",
    cell: ({ row }) => <span className="tabular-nums">{row.original.paid}</span>,
  },
  {
    accessorKey: "payouts_cents",
    header: "Payouts",
    cell: ({ row }) => (
      <span className="tabular-nums">{formatCentsUSD(row.original.payouts_cents)}</span>
    ),
  },
  {
    accessorKey: "revenue_cents",
    header: "Attributed revenue",
    cell: ({ row }) => (
      <span className="tabular-nums">{formatCentsUSD(row.original.revenue_cents)}</span>
    ),
  },
];

export default function ReferralPnlPage() {
  const query = useAdminQuery<{ rows: PartnerPnlRow[] }>("referral-pnl", [], "admin-referrals");
  return (
    <div className="space-y-6">
      <PageHeader
        title="Referral P&L"
        description="Funnel and payout economics for every referral partner."
      />
      <DataState
        query={query}
        empty={{
          title: "No referral activity yet",
          isEmpty: (data) => (data?.rows?.length ?? 0) === 0,
        }}
        render={(data) => <DataTable columns={columns} data={data.rows} />}
      />
    </div>
  );
}
