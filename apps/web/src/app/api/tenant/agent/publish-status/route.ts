import { NextResponse } from "next/server";
import { readAgentConfigForPublish } from "@/lib/settings/publish-config";
import { computePublishStatus, type PublishStatus } from "@/lib/settings/publish-status";
import { requireTenantMember } from "@/lib/settings/route-auth";

export const runtime = "nodejs";

/** `timezone` is the business zone, so the page can show "last published" in it (QA-1 F-18). */
export type PublishStatusResponse = PublishStatus & { timezone?: string | null };

/**
 * `GET /api/tenant/agent/publish-status` (SETTINGS-1): drives
 * `AgentPublishStatus`' "Changes pending" badge from the settings that
 * really need a republish — see `lib/settings/publish-status.ts`. Read
 * server-side so `compiled_config` (tens of KB) never ships to the browser.
 */
export async function GET() {
  const auth = await requireTenantMember();
  if (!auth.ok) return auth.response;

  const [configRead, tenantRes] = await Promise.all([
    readAgentConfigForPublish(auth.supabase, auth.tenantId),
    auth.supabase
      .from("tenants")
      .select("language_config, timezone")
      .eq("id", auth.tenantId)
      .maybeSingle(),
  ]);
  if (!configRead.ok || tenantRes.error) {
    return NextResponse.json({ error: "read_failed" }, { status: 500 });
  }
  const config = configRead.row;

  const status: PublishStatusResponse = {
    ...computePublishStatus({
      publishedAt: config?.published_at ?? null,
      compiledConfig: config?.compiled_config ?? null,
      transferNumber: config?.transfer_number ?? null,
      languageConfig: tenantRes.data?.language_config ?? null,
      compiledWithVersion: config?.compiled_with_version,
    }),
    timezone: tenantRes.data?.timezone ?? null,
  };
  return NextResponse.json(status);
}
