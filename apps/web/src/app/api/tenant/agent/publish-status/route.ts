import { NextResponse } from "next/server";
import { computePublishStatus, type PublishStatus } from "@/lib/settings/publish-status";
import { requireTenantMember } from "@/lib/settings/route-auth";

export const runtime = "nodejs";

export type PublishStatusResponse = PublishStatus;

/**
 * `GET /api/tenant/agent/publish-status` (SETTINGS-1): drives
 * `AgentPublishStatus`' "Changes pending" badge from the settings that
 * really need a republish — see `lib/settings/publish-status.ts`. Read
 * server-side so `compiled_config` (tens of KB) never ships to the browser.
 */
export async function GET() {
  const auth = await requireTenantMember();
  if (!auth.ok) return auth.response;

  const [configRes, tenantRes] = await Promise.all([
    auth.supabase
      .from("agent_configs")
      .select("published_at, compiled_config, transfer_number")
      .eq("tenant_id", auth.tenantId)
      .maybeSingle(),
    auth.supabase.from("tenants").select("language_config").eq("id", auth.tenantId).maybeSingle(),
  ]);
  if (configRes.error || tenantRes.error) {
    return NextResponse.json({ error: "read_failed" }, { status: 500 });
  }

  const status: PublishStatusResponse = computePublishStatus({
    publishedAt: configRes.data?.published_at ?? null,
    compiledConfig: configRes.data?.compiled_config ?? null,
    transferNumber: configRes.data?.transfer_number ?? null,
    languageConfig: tenantRes.data?.language_config ?? null,
  });
  return NextResponse.json(status);
}
