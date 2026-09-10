"use client";

import { formatCentsUSD } from "@heyloo/canonical-types";
import { DataState, DataTable, PageHeader, type W9Status, W9StatusBadge } from "@heyloo/ui";
import type { ColumnDef } from "@tanstack/react-table";
import { useRouter } from "@/i18n/navigation";
import { useAdminQuery } from "@/lib/hooks/use-admin-query";

interface PartnerRow {
  id: string;
  name: string;
  email: string;
  w9_status: W9Status;
  ytd_payout_cents: number;
  rate_bps: number | null;
  commission_base: "gross_profit" | "revenue";
  duration_months: number | null;
}

function formatRate(row: PartnerRow): string {
  if (row.rate_bps == null) return "No recurring commission";
  const pct = (row.rate_bps / 100).toFixed(2).replace(/\.?0+$/, "");
  const base = row.commission_base === "gross_profit" ? "gross profit" : "revenue";
  const duration = row.duration_months ? `for ${row.duration_months} mo` : "lifetime";
  return `${pct}% of ${base}, ${duration}`;
}

const columns: ColumnDef<PartnerRow, unknown>[] = [
  { accessorKey: "name", header: "Partner" },
  {
    id: "terms",
    header: "Commission terms",
    cell: ({ row }) => formatRate(row.original),
  },
  {
    accessorKey: "w9_status",
    header: "W-9",
    cell: ({ row }) => <W9StatusBadge status={row.original.w9_status} />,
  },
  {
    accessorKey: "ytd_payout_cents",
    header: "YTD paid",
    cell: ({ row }) => (
      <span className="tabular-nums">
        {Number.isFinite(row.original.ytd_payout_cents)
          ? formatCentsUSD(row.original.ytd_payout_cents)
          : "—"}
      </span>
    ),
  },
];

/** Admin partners page (Cluster H task brief item 4) — per-partner rate_bps/base/duration + per-vertical overrides live on the detail page. */
export default function AdminPartnersPage() {
  const router = useRouter();
  const query = useAdminQuery<{ rows: PartnerRow[] }>(
    "referral_partners",
    [],
    "admin-referral-partners",
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Partners"
        description="Referral partners, their commission terms, and W-9 status."
      />
      <DataState
        query={query}
        empty={{ title: "No referral partners yet" }}
        render={(data) => (
          <DataTable
            columns={columns}
            data={data.rows}
            onRowClick={(row) => router.push(`/cockpit/partners/${row.id}`)}
            renderMobileCard={(row) => (
              <div className="rounded-lg border border-border p-3">
                <p className="text-sm font-medium">{row.name}</p>
                <p className="text-xs text-muted-foreground">{formatRate(row)}</p>
              </div>
            )}
          />
        )}
      />
    </div>
  );
}
