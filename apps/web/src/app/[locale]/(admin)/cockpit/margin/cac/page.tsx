"use client";

import { formatCentsUSD } from "@heyloo/canonical-types";
import { DataState, DataTable, PageHeader } from "@heyloo/ui";
import { TrendChart } from "@heyloo/ui/charts";
import type { ColumnDef } from "@tanstack/react-table";
import { useAdminQuery } from "@/lib/hooks/use-admin-query";

interface CacPoint {
  label: string;
  value: number;
}

interface ChannelRow {
  channel: string;
  total_cost_cents: number;
  lead_count: number;
  converted_tenant_count: number;
  cac_cents: number | null;
}

interface CacResponse {
  byChannel: Record<string, CacPoint[]>;
  channels?: ChannelRow[];
}

const columns: ColumnDef<ChannelRow, unknown>[] = [
  {
    accessorKey: "channel",
    header: "Channel",
    cell: ({ row }) => (
      <span className="capitalize">{row.original.channel.replace(/_/g, " ")}</span>
    ),
  },
  {
    accessorKey: "total_cost_cents",
    header: "Spend",
    cell: ({ row }) => (
      <span className="tabular-nums">{formatCentsUSD(row.original.total_cost_cents)}</span>
    ),
  },
  {
    accessorKey: "lead_count",
    header: "Leads",
    cell: ({ row }) => <span className="tabular-nums">{row.original.lead_count}</span>,
  },
  {
    accessorKey: "converted_tenant_count",
    header: "Converted",
    cell: ({ row }) => <span className="tabular-nums">{row.original.converted_tenant_count}</span>,
  },
  {
    accessorKey: "cac_cents",
    header: "CAC",
    cell: ({ row }) => (
      <span className="tabular-nums">
        {row.original.cac_cents === null ? "—" : formatCentsUSD(row.original.cac_cents)}
      </span>
    ),
  },
];

export default function CacPage() {
  const query = useAdminQuery<CacResponse>("cac", [], "admin-cac");
  return (
    <div className="space-y-6">
      <PageHeader
        title="Customer acquisition cost"
        description="Spend per converted (non-test) customer by outreach channel; the trend is each month's spend divided by the customers it converted."
      />
      <DataState
        query={query}
        empty={{
          title: "No CAC data yet",
          isEmpty: (data) =>
            Object.keys(data?.byChannel ?? {}).length === 0 && (data?.channels?.length ?? 0) === 0,
        }}
        render={(data) => (
          <div className="space-y-6">
            {(data.channels?.length ?? 0) > 0 && (
              <DataTable columns={columns} data={data.channels ?? []} />
            )}
            <div className="grid gap-6 sm:grid-cols-2">
              {Object.entries(data.byChannel ?? {}).map(([channel, points]) => (
                <div key={channel} className="rounded-lg border border-border p-4 shadow-xs">
                  <h2 className="mb-2 text-small font-medium capitalize">
                    {channel.replace(/_/g, " ")}
                  </h2>
                  <TrendChart data={points} />
                </div>
              ))}
            </div>
          </div>
        )}
      />
    </div>
  );
}
