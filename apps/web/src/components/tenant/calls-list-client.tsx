"use client";

import type { CallClassification } from "@heyloo/supabase-client";
import {
  Badge,
  Button,
  DataTable,
  formatDuration,
  formatPhoneDisplay,
  Input,
  PageHeader,
  StatusBadge,
} from "@heyloo/ui";
import type { ColumnDef } from "@tanstack/react-table";
import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { buildCallOrFilter, CALL_CLASSIFICATIONS, parseCallSearch } from "@/lib/calls/filters";
import { useTenantQuery } from "@/lib/hooks/use-tenant-query";
import { supabaseBrowserClient } from "@/lib/supabase/browser";
import { shiftDateKey, tenantMidnightIso } from "@/lib/tenant/tz";

interface CallRow {
  id: string;
  started_at: string | null;
  caller_number: string | null;
  classification: CallClassification | null;
  duration_seconds: number | null;
  outcome: string | null;
  urgency_flag: boolean;
  sentiment: "positive" | "neutral" | "negative" | null;
  /** `customers.name` for the caller's number, when the tenant has that customer (QA-1 F-15). */
  customer_name?: string | null;
}

const PAGE_SIZE = 25;

const CLASSIFICATIONS = CALL_CLASSIFICATIONS as readonly CallClassification[];

const SENTIMENT_VARIANT: Record<string, "success" | "secondary" | "destructive"> = {
  positive: "success",
  neutral: "secondary",
  negative: "destructive",
};

const columns: ColumnDef<CallRow, unknown>[] = [
  {
    accessorKey: "started_at",
    header: "Time",
    cell: ({ row }) => (
      <span className="flex items-center gap-1.5">
        {row.original.urgency_flag && (
          <Badge variant="destructive" className="shrink-0">
            Urgent
          </Badge>
        )}
        {row.original.started_at
          ? new Date(row.original.started_at).toLocaleString()
          : "In progress"}
      </span>
    ),
  },
  {
    accessorKey: "caller_number",
    header: "Customer",
    cell: ({ row }) => {
      const number = row.original.caller_number
        ? formatPhoneDisplay(row.original.caller_number)
        : "Unknown";
      const name = row.original.customer_name?.trim();
      return name ? (
        <span className="flex flex-col">
          <span>{name}</span>
          <span className="text-xs text-muted-foreground">{number}</span>
        </span>
      ) : (
        number
      );
    },
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
    accessorKey: "sentiment",
    header: "Sentiment",
    cell: ({ row }) =>
      row.original.sentiment ? (
        <Badge variant={SENTIMENT_VARIANT[row.original.sentiment] ?? "outline"}>
          {row.original.sentiment}
        </Badge>
      ) : (
        "—"
      ),
  },
  {
    accessorKey: "duration_seconds",
    header: "Duration",
    cell: ({ row }) => formatDuration(row.original.duration_seconds),
  },
  { accessorKey: "outcome", header: "Outcome", cell: ({ row }) => row.original.outcome ?? "—" },
];

interface AppliedFilters {
  classification: string;
  search: string;
  from: string;
  to: string;
}

const NO_FILTERS: AppliedFilters = { classification: "all", search: "", from: "", to: "" };

/** Tenant-local [from 00:00, to+1 day 00:00) as ISO instants (either bound optional). */
function dateRangeInstants(
  tz: string,
  from: string,
  to: string,
): { after: string | null; before: string | null } {
  return {
    after: from ? tenantMidnightIso(tz, from) : null,
    before: to ? tenantMidnightIso(tz, shiftDateKey(to, 1)) : null,
  };
}

export function CallsListClient({
  tenantId,
  tenantTz = "UTC",
}: {
  tenantId: string;
  /** Tenant IANA timezone: the from/to dates are tenant-local days, never UTC. */
  tenantTz?: string;
}) {
  const router = useRouter();
  const [page, setPage] = useState(0);
  const [filters, setFilters] = useState<AppliedFilters>(NO_FILTERS);
  // The search box is applied on submit (Enter / Search), not per keystroke: a
  // name search costs an extra customers lookup.
  const [searchDraft, setSearchDraft] = useState("");
  const { classification, search, from, to } = filters;
  const { after, before } = dateRangeInstants(tenantTz, from, to);
  const hasFilters = classification !== "all" || !!search || !!from || !!to;

  const query = useTenantQuery(
    tenantId,
    "call_logs",
    ["list", page, classification, search, from, to, tenantTz],
    async () => {
      // Number / customer-name search (QA-1 F-15): digits match caller_number,
      // letters match customers' names -> their numbers. The .or() expression is
      // built only from digits and validated E.164 numbers.
      let orFilter: string | null = null;
      if (search) {
        const term = parseCallSearch(search);
        let phones: string[] = [];
        if (term.namePattern) {
          const { data: customers } = await supabaseBrowserClient
            .from("customers")
            .select("phone_e164")
            .eq("tenant_id", tenantId)
            .ilike("name", term.namePattern)
            .limit(50);
          phones = (customers ?? []).map((c) => c.phone_e164);
        }
        orFilter = buildCallOrFilter(term, phones);
        if (!orFilter) return { rows: [] as CallRow[], pageCount: 1 };
      }

      let q = supabaseBrowserClient
        .from("call_logs")
        .select(
          "id, started_at, caller_number, classification, duration_seconds, outcome, urgency_flag, sentiment",
          { count: "exact" },
        )
        .eq("tenant_id", tenantId)
        // Voice-only surface: exclude the text-agent's shadow call_logs rows
        // (channel 'sms'/'web_chat', started_at always null — see
        // `20260911101000_channels_tenant_and_call_log_columns.sql`), which
        // would otherwise sort to the top under Postgres's NULLS FIRST
        // default for DESC and render as a blank "In progress" call.
        .in("channel", ["phone", "web_voice"])
        .order("started_at", { ascending: false, nullsFirst: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

      if (classification !== "all") {
        q = q.eq("classification", classification as CallClassification);
      }
      if (after) q = q.gte("started_at", after);
      if (before) q = q.lt("started_at", before);
      if (orFilter) q = q.or(orFilter);

      const { data, count, error } = await q;
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as CallRow[];

      // Resolve the caller's name for this page of calls (one tenant-scoped lookup).
      const numbers = [
        ...new Set(rows.map((r) => r.caller_number).filter((n): n is string => !!n)),
      ];
      if (numbers.length) {
        const { data: customers } = await supabaseBrowserClient
          .from("customers")
          .select("phone_e164, name")
          .eq("tenant_id", tenantId)
          .in("phone_e164", numbers);
        const nameByPhone = new Map((customers ?? []).map((c) => [c.phone_e164, c.name]));
        for (const r of rows)
          r.customer_name = r.caller_number ? (nameByPhone.get(r.caller_number) ?? null) : null;
      }
      return {
        rows,
        pageCount: Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE)),
      };
    },
  );

  function applyFilters(next: Partial<AppliedFilters>) {
    setFilters((prev) => ({ ...prev, ...next }));
    setPage(0);
  }

  // The export carries the active filters so it matches what is on screen (QA-1 F-17).
  const exportParams = new URLSearchParams({ tenant_id: tenantId });
  if (classification !== "all") exportParams.set("classification", classification);
  if (search) exportParams.set("q", search);
  if (after) exportParams.set("started_after", after);
  if (before) exportParams.set("started_before", before);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Calls"
        actions={
          <Button variant="outline" size="sm" asChild>
            <a href={`/api/tenant/calls/export?${exportParams.toString()}`}>Export CSV</a>
          </Button>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            applyFilters({ search: searchDraft.trim() });
          }}
        >
          <Input
            aria-label="Search calls by number or name"
            className="w-full sm:w-60"
            placeholder="Search number or name"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
          />
          <Button type="submit" variant="outline" size="sm">
            Search
          </Button>
        </form>
        <div className="flex flex-col gap-1 text-xs text-muted-foreground">
          From
          <Input
            type="date"
            aria-label="From date"
            className="w-40"
            value={from}
            max={to || undefined}
            onChange={(e) => applyFilters({ from: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1 text-xs text-muted-foreground">
          To
          <Input
            type="date"
            aria-label="To date"
            className="w-40"
            value={to}
            min={from || undefined}
            onChange={(e) => applyFilters({ to: e.target.value })}
          />
        </div>
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
            onChange: (v) => applyFilters({ classification: v }),
            options: [
              { label: "All classifications", value: "all" },
              ...CLASSIFICATIONS.map((c) => ({ label: c.replace(/_/g, " "), value: c })),
            ],
          },
        ]}
        emptyState={
          hasFilters
            ? {
                title: "No calls match your filters",
                action: {
                  label: "Clear filters",
                  onClick: () => {
                    setFilters(NO_FILTERS);
                    setSearchDraft("");
                    setPage(0);
                  },
                },
              }
            : {
                title: "No calls yet",
                description: "Once your number is forwarded, calls land here.",
              }
        }
        renderMobileCard={(row) => (
          <div className="rounded-lg border border-border p-3">
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-medium">
                {row.customer_name?.trim() ||
                  (row.caller_number ? formatPhoneDisplay(row.caller_number) : "Unknown")}
              </p>
              {row.urgency_flag && <Badge variant="destructive">Urgent</Badge>}
            </div>
            <p className="text-xs text-muted-foreground">
              {row.started_at ? new Date(row.started_at).toLocaleString() : "In progress"}
            </p>
            <div className="mt-1 flex items-center gap-1.5">
              {row.classification && (
                <StatusBadge variant="call-class" value={row.classification} />
              )}
              {row.sentiment && (
                <Badge variant={SENTIMENT_VARIANT[row.sentiment] ?? "outline"}>
                  {row.sentiment}
                </Badge>
              )}
            </div>
          </div>
        )}
      />
    </div>
  );
}
