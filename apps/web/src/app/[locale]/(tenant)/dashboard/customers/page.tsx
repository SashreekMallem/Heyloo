"use client";

import {
  Badge,
  type CustomerSegment,
  DataState,
  DataTable,
  formatPhoneDisplay,
  Input,
  PageHeader,
  SegmentBadge,
} from "@heyloo/ui";
import type { ColumnDef } from "@tanstack/react-table";
import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { buildCustomerSearchFilters } from "@/lib/customers/search";
import { useTenantQuery } from "@/lib/hooks/use-tenant-query";
import { supabaseBrowserClient } from "@/lib/supabase/browser";
import { useCurrentTenantId } from "@/lib/tenant/tenant-context";

interface CustomerRow {
  id: string;
  name: string | null;
  phone_e164: string;
  segment: CustomerSegment;
  lifetime_value_cents: number;
  consent: { sms?: boolean; call?: boolean };
  /** STOP / opt-out: takes precedence over any consent on file (QA-1 F-09). */
  sms_opt_out: boolean;
  last_seen_at?: string | null;
}

const CUSTOMER_COLUMNS =
  "id, name, phone_e164, segment, lifetime_value_cents, consent, sms_opt_out, last_seen_at";
const RESULT_LIMIT = 100;

const columns: ColumnDef<CustomerRow, unknown>[] = [
  { accessorKey: "name", header: "Name", cell: ({ row }) => row.original.name ?? "Unknown" },
  {
    accessorKey: "phone_e164",
    header: "Phone",
    cell: ({ row }) => formatPhoneDisplay(row.original.phone_e164),
  },
  {
    accessorKey: "segment",
    header: "Segment",
    cell: ({ row }) => <SegmentBadge segment={row.original.segment} />,
  },
  {
    accessorKey: "consent",
    header: "Consent",
    cell: ({ row }) =>
      row.original.sms_opt_out ? (
        <Badge variant="destructive">Opted out</Badge>
      ) : row.original.consent?.sms || row.original.consent?.call ? (
        <Badge variant="success">On file</Badge>
      ) : (
        <Badge variant="outline">None</Badge>
      ),
  },
];

export default function CustomersPage() {
  const tenantId = useCurrentTenantId();
  const router = useRouter();
  const [search, setSearch] = useState("");

  const query = useTenantQuery(
    tenantId ?? "",
    "customers",
    [search],
    async () => {
      const { namePattern, phonePattern } = buildCustomerSearchFilters(search);
      const base = () =>
        supabaseBrowserClient
          .from("customers")
          .select(CUSTOMER_COLUMNS)
          .eq("tenant_id", tenantId as string)
          .order("last_seen_at", { ascending: false })
          .limit(RESULT_LIMIT);

      if (!namePattern) {
        const { data, error } = await base();
        if (error) throw new Error(error.message);
        return (data ?? []) as CustomerRow[];
      }

      // Two plain ilike filters merged client-side, never a hand-built `.or()`
      // string: a comma / paren / % in the term used to break or inject into
      // the PostgREST filter (QA-1 F-10 / SEC-15). Phones match on digits only.
      const [byName, byPhone] = await Promise.all([
        base().ilike("name", namePattern),
        phonePattern ? base().ilike("phone_e164", phonePattern) : Promise.resolve(null),
      ]);
      const failure = byName.error ?? byPhone?.error;
      if (failure) throw new Error(failure.message);
      const merged = new Map<string, CustomerRow>();
      for (const row of [...(byName.data ?? []), ...(byPhone?.data ?? [])]) {
        merged.set(row.id, row as CustomerRow);
      }
      return [...merged.values()]
        .sort((a, b) => ((a.last_seen_at ?? "") < (b.last_seen_at ?? "") ? 1 : -1))
        .slice(0, RESULT_LIMIT);
    },
    { enabled: !!tenantId },
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Customers"
        actions={
          <Input
            className="w-full sm:w-56"
            placeholder="Search name or phone"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        }
      />
      <DataState
        query={query}
        empty={
          search.trim()
            ? {
                title: `No customers match "${search.trim()}"`,
                description: "Check the spelling, or search by part of the phone number.",
              }
            : {
                title: "No customers yet",
                description: "Customers appear here after their first call or booking.",
              }
        }
        render={(customers) => (
          <DataTable
            columns={columns}
            data={customers}
            onRowClick={(row) => router.push(`/dashboard/customers/${row.id}`)}
            renderMobileCard={(row) => (
              <div className="rounded-lg border border-border p-3">
                <p className="text-sm font-medium">{row.name ?? "Unknown"}</p>
                <p className="text-xs text-muted-foreground">
                  {formatPhoneDisplay(row.phone_e164)}
                </p>
                <div className="mt-1 flex items-center gap-1.5">
                  <SegmentBadge segment={row.segment} />
                  {row.sms_opt_out ? (
                    <Badge variant="destructive">Opted out</Badge>
                  ) : (
                    (row.consent?.sms || row.consent?.call) && (
                      <Badge variant="success">Consent</Badge>
                    )
                  )}
                </div>
              </div>
            )}
          />
        )}
      />
    </div>
  );
}
