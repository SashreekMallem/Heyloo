"use client";

import {
  Badge,
  type CustomerSegment,
  DataState,
  DataTable,
  Input,
  PageHeader,
  SegmentBadge,
} from "@heyloo/ui";
import type { ColumnDef } from "@tanstack/react-table";
import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
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
}

const columns: ColumnDef<CustomerRow, unknown>[] = [
  { accessorKey: "name", header: "Name", cell: ({ row }) => row.original.name ?? "Unknown" },
  { accessorKey: "phone_e164", header: "Phone" },
  {
    accessorKey: "segment",
    header: "Segment",
    cell: ({ row }) => <SegmentBadge segment={row.original.segment} />,
  },
  {
    accessorKey: "consent",
    header: "Consent",
    cell: ({ row }) =>
      row.original.consent?.sms || row.original.consent?.call ? (
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
      let q = supabaseBrowserClient
        .from("customers")
        .select("id, name, phone_e164, segment, lifetime_value_cents, consent")
        .eq("tenant_id", tenantId as string)
        .order("last_seen_at", { ascending: false })
        .limit(100);
      if (search) q = q.or(`name.ilike.%${search}%,phone_e164.ilike.%${search}%`);
      const { data } = await q;
      return (data ?? []) as CustomerRow[];
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
        empty={{
          title: "No customers yet",
          description: "Customers appear here after their first call or booking.",
        }}
        render={(customers) => (
          <DataTable
            columns={columns}
            data={customers}
            onRowClick={(row) => router.push(`/dashboard/customers/${row.id}`)}
            renderMobileCard={(row) => (
              <div className="rounded-lg border border-border p-3">
                <p className="text-sm font-medium">{row.name ?? "Unknown"}</p>
                <p className="text-xs text-muted-foreground">{row.phone_e164}</p>
                <div className="mt-1 flex items-center gap-1.5">
                  <SegmentBadge segment={row.segment} />
                  {(row.consent?.sms || row.consent?.call) && (
                    <Badge variant="success">Consent</Badge>
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
