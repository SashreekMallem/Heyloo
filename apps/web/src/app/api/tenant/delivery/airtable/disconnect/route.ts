import { NextResponse } from "next/server";
import { createSupabaseServiceRoleServerClient } from "@/lib/supabase/service-role";
import { requireTenantIdFromSession } from "../session";
import { untypedTable } from "../shared";

export const runtime = "nodejs";

/**
 * Airtable disconnect (FRONTEND_SPEC.md §6.8). Marks the tenant's own
 * `adapter_connections` row disconnected and clears the stored tokens.
 * KNOWN GAP (docs/VERIFY.md): does not call an Airtable-side token-revoke
 * endpoint — Airtable's public OAuth reference does not document a revoke
 * endpoint reachable from this egress-blocked environment; clearing our own
 * stored token is still real (Airtable's own token TTL/refresh-rotation
 * then naturally invalidates it), just not an active provider-side revoke.
 */
export async function POST() {
  const tenantId = await requireTenantIdFromSession();
  if (!tenantId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const service = createSupabaseServiceRoleServerClient();
  const { error } = await untypedTable(service, "adapter_connections")
    .update({
      status: "disconnected",
      disconnected_at: new Date().toISOString(),
      access_token: null,
      refresh_token: null,
    })
    .eq("tenant_id", tenantId)
    .eq("provider", "airtable");

  if (error) return NextResponse.json({ error: "disconnect_failed" }, { status: 502 });
  return NextResponse.json({ disconnected: true });
}
