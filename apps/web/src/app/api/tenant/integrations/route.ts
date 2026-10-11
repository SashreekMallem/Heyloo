import { NextResponse } from "next/server";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";
import { requireIntegrationsSession } from "./session";
import {
  ADAPTER_DISPLAY_NAMES,
  ADAPTER_PROVIDERS,
  type ConnectionDisplayStatus,
  calendarReadFailing,
  connectionDisplayStatus,
  isComingSoon,
  untypedTable,
} from "./shared";

export const runtime = "nodejs";

export interface IntegrationStatus {
  provider: string;
  display_name: string;
  /** `error` = "Needs reconnect": disconnected for a reason other than the owner's own disconnect (CONNECT-SAFE-1). */
  status: ConnectionDisplayStatus;
  last_refreshed_at: string | null;
  /** CAL-1: Google Calendar only — when its busy times were last read
   * successfully (`adapter_connections.busy_synced_at`); null otherwise.
   * CAL-1b: reads happen when the calendar changes (push), not on a timer, so
   * an old value is normal for a calendar nobody edited. */
  last_checked_at: string | null;
  /** CAL-1b: Google Calendar only — a read (or its push channel) is failing
   * and being retried (`last_error` carries the sync's prefix while connected). */
  calendar_read_failing?: boolean;
  /** Internal reason text (e.g. "square 401 on booking push"); the page shows friendly copy instead. */
  last_error: string | null;
  /** False while the provider is "Coming soon": a new connection is refused (CONNECT-SAFE-1). */
  available: boolean;
  can_manage: boolean;
}

export interface IntegrationsListResponse {
  integrations: IntegrationStatus[];
}

interface ConnectionRow {
  provider: string;
  status: string;
  last_refreshed_at: string | null;
  last_error: string | null;
  busy_synced_at?: string | null;
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
    .select("provider, status, last_refreshed_at, last_error, busy_synced_at")
    .eq("tenant_id", session.tenantId)
    .in("provider", ADAPTER_PROVIDERS);

  const byProvider = new Map<string, ConnectionRow>(
    ((rows ?? []) as ConnectionRow[]).map((r) => [r.provider, r]),
  );

  const integrations: IntegrationStatus[] = ADAPTER_PROVIDERS.map((provider) => {
    const row = byProvider.get(provider);
    return {
      provider,
      display_name: ADAPTER_DISPLAY_NAMES[provider],
      status: connectionDisplayStatus(row),
      last_refreshed_at: row?.last_refreshed_at ?? null,
      last_checked_at: provider === "google_calendar" ? (row?.busy_synced_at ?? null) : null,
      calendar_read_failing: provider === "google_calendar" && calendarReadFailing(row),
      last_error: row?.last_error ?? null,
      available: !isComingSoon(provider),
      can_manage: session.canManage,
    };
  });

  const body: IntegrationsListResponse = { integrations };
  return NextResponse.json(body);
}
