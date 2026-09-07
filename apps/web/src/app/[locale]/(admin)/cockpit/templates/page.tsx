"use client";

import { DataState, DataTable } from "@heyloo/ui";
import type { ColumnDef } from "@tanstack/react-table";
import { useRouter } from "@/i18n/navigation";
import { useAdminQuery } from "@/lib/hooks/use-admin-query";

interface TemplateRow {
  vertical: string;
  version: number;
  updated_at: string;
}

const columns: ColumnDef<TemplateRow, unknown>[] = [
  { accessorKey: "vertical", header: "Vertical" },
  { accessorKey: "version", header: "Published version" },
  {
    accessorKey: "updated_at",
    header: "Last updated",
    cell: ({ row }) => new Date(row.original.updated_at).toLocaleString(),
  },
];

export default function TemplatesListPage() {
  const router = useRouter();
  const query = useAdminQuery<{ templates: TemplateRow[] }>("templates", [], "admin-templates");

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Agent templates</h1>
      <DataState
        query={query}
        empty={{ title: "No templates found" }}
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
