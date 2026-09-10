"use client";

import { Button, DataState, DataTable, PageHeader, StatusBadge } from "@heyloo/ui";
import type { ColumnDef } from "@tanstack/react-table";
import { Link, useRouter } from "@/i18n/navigation";
import { useAdminQuery } from "@/lib/hooks/use-admin-query";

interface CampaignRow {
  id: string;
  name: string;
  vertical: string | null;
  status: string;
  complaint_rate: number | null;
}

const columns: ColumnDef<CampaignRow, unknown>[] = [
  { accessorKey: "name", header: "Campaign" },
  { accessorKey: "vertical", header: "Vertical", cell: ({ row }) => row.original.vertical ?? "—" },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <StatusBadge variant="tenant" value={row.original.status} />,
  },
];

export default function CampaignsListPage() {
  const router = useRouter();
  const query = useAdminQuery<{ rows: CampaignRow[] }>("campaigns", [], "admin-outreach/campaigns");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Campaigns"
        actions={
          <Button asChild>
            <Link href="/cockpit/outreach/campaigns/new">New campaign</Link>
          </Button>
        }
      />
      <DataState
        query={query}
        empty={{ title: "No campaigns yet" }}
        render={(data) => (
          <DataTable
            columns={columns}
            data={data.rows}
            onRowClick={(row) => router.push(`/cockpit/outreach/campaigns/${row.id}`)}
            emptyState={{
              title: "No campaigns yet",
              action: {
                label: "New campaign",
                onClick: () => router.push("/cockpit/outreach/campaigns/new"),
              },
            }}
          />
        )}
      />
    </div>
  );
}
