import { NextResponse } from "next/server";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";
import { requireTenantIdFromSession } from "../session";
import { untypedTable } from "../shared";

export const runtime = "nodejs";

export interface AirtableStatusResponse {
  status: "connected" | "disconnected" | "error";
  base_name: string | null;
  last_synced_at: string | null;
  sync_log: {
    entity_type: string;
    entity_id: string;
    last_synced_at: string | null;
    sync_conflict: boolean;
  }[];
}

/**
 * Real Airtable connection status + a recent sync-log slice (FRONTEND_SPEC.md
 * §6.8's "collapsible sync-log viewer") — reads the tenant's OWN
 * `adapter_connections`/`adapter_sync_state` rows (RLS already scopes both
 * to the caller's tenant; no service-role bypass needed for a read).
 *
 * The sync log reads `public.adapter_sync_state` (filtered
 * `provider = 'airtable'`), the same generic T7 table
 * `worker-adapter-push/handler.ts`'s `recordSyncSuccess` actually writes to
 * for every adapter including Airtable — NOT the older, Airtable-only
 * `public.airtable_sync_state` table, which no writer populates (REPAIR-
 * 2026-09, docs/audit/FIX_REQUESTS.md: a real push success was landing in
 * `adapter_sync_state` and never surfacing here until this fix).
 */
export async function GET() {
  const tenantId = await requireTenantIdFromSession();
  if (!tenantId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const supabase = await createSupabaseServerComponentClient();

  const [{ data: connection }, { data: syncRows }] = await Promise.all([
    untypedTable(supabase, "adapter_connections")
      .select("status, metadata, last_refreshed_at")
      .eq("tenant_id", tenantId)
      .eq("provider", "airtable")
      .maybeSingle(),
    untypedTable(supabase, "adapter_sync_state")
      .select("entity_type, entity_id, last_synced_at, sync_conflict")
      .eq("tenant_id", tenantId)
      .eq("provider", "airtable")
      .order("last_synced_at", { ascending: false, nullsFirst: false })
      .limit(20),
  ]);

  const metadata = (connection?.metadata ?? {}) as { base_name?: string };
  const body: AirtableStatusResponse = {
    status: (connection?.status as AirtableStatusResponse["status"]) ?? "disconnected",
    base_name: metadata.base_name ?? null,
    last_synced_at: connection?.last_refreshed_at ?? null,
    sync_log: (syncRows ?? []) as AirtableStatusResponse["sync_log"],
  };
  return NextResponse.json(body);
}
