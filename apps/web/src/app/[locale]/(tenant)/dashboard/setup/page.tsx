"use client";

import { Card, CardContent, CardHeader, CardTitle, DataState, PageHeader } from "@heyloo/ui";
import { ArrowRight } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { useTenantQuery } from "@/lib/hooks/use-tenant-query";
import { supabaseBrowserClient } from "@/lib/supabase/browser";
import { useCurrentTenantId } from "@/lib/tenant/tenant-context";

interface SetupSummary {
  vertical: string;
  resourceCount: number;
  offeringCount: number;
}

const VERTICAL_RESOURCE_LABEL: Record<string, string> = {
  motel: "rooms",
  dental: "chairs",
  vet: "exam rooms",
  auto: "bays",
  restaurant: "tables",
};

const VERTICAL_OFFERING_LABEL: Record<string, string> = {
  restaurant: "menu items",
  motel: "room types",
};

export default function SetupIndexPage() {
  const tenantId = useCurrentTenantId();

  const query = useTenantQuery(
    tenantId ?? "",
    "setup_summary",
    [],
    async (): Promise<SetupSummary> => {
      const [{ data: tenant }, { count: resourceCount }, { count: offeringCount }] =
        await Promise.all([
          supabaseBrowserClient
            .from("tenants")
            .select("vertical")
            .eq("id", tenantId as string)
            .maybeSingle(),
          supabaseBrowserClient
            .from("resources")
            .select("id", { count: "exact", head: true })
            .eq("tenant_id", tenantId as string)
            .eq("active", true),
          supabaseBrowserClient
            .from("offerings")
            .select("id", { count: "exact", head: true })
            .eq("tenant_id", tenantId as string)
            .eq("active", true),
        ]);
      return {
        vertical: tenant?.vertical ?? "generic",
        resourceCount: resourceCount ?? 0,
        offeringCount: offeringCount ?? 0,
      };
    },
    { enabled: !!tenantId },
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Setup"
        description="Configure what your AI can actually book and sell — resources and offerings feed availability, pricing, and the ordering/booking tools directly."
      />

      <DataState
        query={query}
        empty={{ title: "Nothing here yet" }}
        render={(summary) => {
          const resourceLabel = VERTICAL_RESOURCE_LABEL[summary.vertical] ?? "resources";
          const offeringLabel = VERTICAL_OFFERING_LABEL[summary.vertical] ?? "offerings/services";
          return (
            <div className="grid gap-4 sm:grid-cols-2">
              <Link href="/dashboard/setup/resources">
                <Card className="transition-colors hover:border-primary">
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="text-base capitalize">{resourceLabel}</CardTitle>
                    <ArrowRight className="size-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-semibold">{summary.resourceCount}</p>
                    <p className="text-sm text-muted-foreground">
                      Chairs, rooms, bays, tables, or staff lines your AI schedules against.
                    </p>
                  </CardContent>
                </Card>
              </Link>
              <Link href="/dashboard/setup/offerings">
                <Card className="transition-colors hover:border-primary">
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="text-base capitalize">{offeringLabel}</CardTitle>
                    <ArrowRight className="size-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-semibold">{summary.offeringCount}</p>
                    <p className="text-sm text-muted-foreground">
                      Services, menu items, and room types with prices, modifiers, and allergens.
                    </p>
                  </CardContent>
                </Card>
              </Link>
              {summary.vertical === "restaurant" && (
                <Link href="/dashboard/setup/offerings/import" className="sm:col-span-2">
                  <Card className="transition-colors hover:border-primary">
                    <CardHeader className="flex flex-row items-center justify-between">
                      <CardTitle className="text-base">Import your menu</CardTitle>
                      <ArrowRight className="size-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground">
                        Paste or upload your menu and review the items before they&apos;re added.
                      </p>
                    </CardContent>
                  </Card>
                </Link>
              )}
            </div>
          );
        }}
      />
    </div>
  );
}
