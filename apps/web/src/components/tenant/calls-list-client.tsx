"use client";

import type { CallClassification } from "@heyloo/supabase-client";
import { Button, DataTable, StatusBadge } from "@heyloo/ui";
import type { ColumnDef } from "@tanstack/react-table";
import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTenantQuery } from "@/lib/hooks/use-tenant-query";
import { supabaseBrowserClient } from "@/lib/supabase/browser";

interface CallRow {
  id: string;
  started_at: string | null;
  caller_number: string | null;
  classification: CallClassification | null;
  duration_seconds: number | null;
  outcome: string | null;
}

const PAGE_SIZE = 25;

const CLASSIFICATIONS: CallClassification[] = [
  "new_booking",
  "reschedule",
  "cancel",
  "question_faq",
  "status_check",
  "sales_lead",
  "solicitor",
  "wrong_number",
  "spam_robocall",
  "emergency",
  "after_hours_message",
  "transfer_request",
];

const columns: ColumnDef<CallRow, unknown>[] = [
  {
    accessorKey: "started_at",
    header: "Time",
    cell: ({ row }) =>
      row.original.started_at ? new Date(row.original.started_at).toLocaleString() : "In progress",
  },
  {
    accessorKey: "caller_number",
    header: "Customer",
    cell: ({ row }) => row.original.caller_number ?? "Unknown",
  },
  {
    accessorKey: "classification",
    header: "Classification",
    cell: ({ row }) =>
      row.original.classification ? (
        <StatusBadge variant="call-class" value={row.original.classification} />
      ) : (
        "—"
      ),
  },
  {
    accessorKey: "duration_seconds",
    header: "Duration",
    cell: ({ row }) =>
      row.original.duration_seconds ? `${Math.round(row.original.duration_seconds / 60)}m` : "—",
  },
  { accessorKey: "outcome", header: "Outcome", cell: ({ row }) => row.original.outcome ?? "—" },
];

export function CallsListClient({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const [page, setPage] = useState(0);
  const [classification, setClassification] = useState<string>("all");

  const query = useTenantQuery(tenantId, "call_logs", ["list", page, classification], async () => {
    let q = supabaseBrowserClient
      .from("call_logs")
      .select("id, started_at, caller_number, classification, duration_seconds, outcome", {
        count: "exact",
      })
      .eq("tenant_id", tenantId)
      .order("started_at", { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

    if (classification !== "all") {
      q = q.eq("classification", classification as CallClassification);
    }

    const { data, count } = await q;
    return {
      rows: (data ?? []) as CallRow[],
      pageCount: Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE)),
    };
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Calls</h1>
        <Button variant="outline" size="sm" asChild>
          <a href={`/api/tenant/calls/export?tenant_id=${tenantId}`}>Export CSV</a>
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={query.data?.rows ?? []}
        pageCount={query.data?.pageCount}
        pageIndex={page}
        onPageChange={setPage}
        onRowClick={(row) => router.push(`/dashboard/calls/${row.id}`)}
        filters={[
          {
            label: "Classification",
            value: classification,
            onChange: (v) => {
              setClassification(v);
              setPage(0);
            },
            options: [
              { label: "All classifications", value: "all" },
              ...CLASSIFICATIONS.map((c) => ({ label: c.replace(/_/g, " "), value: c })),
            ],
          },
        ]}
        emptyState={
          classification !== "all"
            ? {
                title: "No calls match your filters",
                action: { label: "Clear filters", onClick: () => setClassification("all") },
              }
            : {
                title: "No calls yet",
                description: "Once your number is forwarded, calls land here.",
              }
        }
        renderMobileCard={(row) => (
          <div className="rounded-lg border border-border p-3">
            <p className="text-sm font-medium">{row.caller_number ?? "Unknown"}</p>
            <p className="text-xs text-muted-foreground">
              {row.started_at ? new Date(row.started_at).toLocaleString() : "In progress"}
            </p>
            {row.classification && (
              <StatusBadge variant="call-class" value={row.classification} className="mt-1" />
            )}
          </div>
        )}
      />
    </div>
  );
}
