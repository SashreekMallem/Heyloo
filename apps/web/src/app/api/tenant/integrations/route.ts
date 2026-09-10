import { NextResponse } from "next/server";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";
import { requireIntegrationsSession } from "./session";
import { ADAPTER_DISPLAY_NAMES, ADAPTER_PROVIDERS, untypedTable } from "./shared";

export const runtime = "nodejs";

export interface IntegrationStatus {
  provider: string;
  display_name: string;
  status: "connected" | "disconnected" | "error";
  last_refreshed_at: string | null;
  last_error: string | null;
  can_manage: boolean;
}

export interface IntegrationsListResponse {
  integrations: IntegrationStatus[];
}

/**
 * Real connection status for every T7 adapter reachable through
 * `api-adapter-connect` (BACKEND_SPEC §7.6) — `shopmonkey`/`ezyvet`/
 * `google_calendar`/`square`. Airtable is a DIFFERENT one-way delivery
 * integration with its own OAuth flow and page
 * (`/dashboard/delivery`, `api/tenant/delivery/airtable/**`) — deliberately
 * not listed here to avoid presenting two competing "connect Airtable"
 * entry points.
 *
 * Reads the tenant's OWN `adapter_connections` rows — RLS already scopes
 * this to the caller's tenant (same posture as
 * `api/tenant/delivery/airtable/status/route.ts`), so no service-role
 * client or extra tenant_id filter is needed for a read.
 */
export async function GET() {
  const session = await requireIntegrationsSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const supabase = await createSupabaseServerComponentClient();
  const { data: rows } = await untypedTable(supabase, "adapter_connections")
    .select("provider, status, last_refreshed_at, last_error")
    .eq("tenant_id", session.tenantId)
    .in("provider", ADAPTER_PROVIDERS);

  const byProvider = new Map<
    string,
    { status: string; last_refreshed_at: string | null; last_error: string | null }
  >(
    (
      (rows ?? []) as {
        provider: string;
        status: string;
        last_refreshed_at: string | null;
        last_error: string | null;
      }[]
    ).map((r) => [r.provider, r]),
  );

  const integrations: IntegrationStatus[] = ADAPTER_PROVIDERS.map((provider) => {
    const row = byProvider.get(provider);
    return {
      provider,
      display_name: ADAPTER_DISPLAY_NAMES[provider],
      status: (row?.status as IntegrationStatus["status"]) ?? "disconnected",
      last_refreshed_at: row?.last_refreshed_at ?? null,
      last_error: row?.last_error ?? null,
      can_manage: session.canManage,
    };
  });

  const body: IntegrationsListResponse = { integrations };
  return NextResponse.json(body);
}
