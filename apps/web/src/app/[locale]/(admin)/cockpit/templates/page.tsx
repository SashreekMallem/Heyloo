"use client";

import { DataState, DataTable, PageHeader } from "@heyloo/ui";
import type { ColumnDef } from "@tanstack/react-table";
import { useRouter } from "@/i18n/navigation";
import { useAdminQuery } from "@/lib/hooks/use-admin-query";

interface TemplateRow {
  vertical: string;
  version: number;
  /** agent_templates has no updated_at column; the row's created_at is the version's publish time. */
  updated_at?: string;
  created_at?: string;
}

const columns: ColumnDef<TemplateRow, unknown>[] = [
  {
    accessorKey: "vertical",
    header: "Vertical",
    cell: ({ row }) => (
      <span className="capitalize">{row.original.vertical.replace(/_/g, " ")}</span>
    ),
  },
  {
    accessorKey: "version",
    header: "Published version",
    cell: ({ row }) => <span className="tabular-nums">{row.original.version}</span>,
  },
  {
    accessorKey: "updated_at",
    header: "Last updated",
    cell: ({ row }) => {
      const ts = row.original.updated_at ?? row.original.created_at;
      return ts ? new Date(ts).toLocaleString() : "—";
    },
  },
];

export default function TemplatesListPage() {
  const router = useRouter();
  const query = useAdminQuery<{ templates: TemplateRow[] }>("templates", [], "admin-templates");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agent templates"
        description="The published conversation template powering each vertical's agent."
      />
      <DataState
        query={query}
        empty={{
          title: "No templates found",
          isEmpty: (data) => (data?.templates?.length ?? 0) === 0,
        }}
        render={(data) => (
          <DataTable
            columns={columns}
            data={data.templates}
            onRowClick={(row) => router.push(`/cockpit/templates/${row.vertical}`)}
          />
        )}
      />
    </div>
  );
}
