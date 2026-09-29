import { NextResponse } from "next/server";
import { type ChecklistItem, computeSettingsChecklist } from "@/lib/settings/checklist";
import { readAgentConfigForPublish } from "@/lib/settings/publish-config";
import { computePublishStatus } from "@/lib/settings/publish-status";
import { requireTenantMember } from "@/lib/settings/route-auth";

export const runtime = "nodejs";

export interface SettingsChecklistResponse {
  items: ChecklistItem[];
  requiredTotal: number;
  requiredDone: number;
}

/**
 * `GET /api/tenant/settings/checklist` (SETTINGS-1): the agent Overview's
 * "Settings checklist" — which key settings are still empty, computed from
 * real rows under the caller's own RLS session (same approach as
 * `api/tenant/setup-progress`, which covers account onboarding; this one
 * covers the settings that change how the AI behaves and who gets alerted).
 */
export async function GET() {
  const auth = await requireTenantMember();
  if (!auth.ok) return auth.response;
  const { supabase, tenantId } = auth;

  const [tenantRes, configRead, offeringsRes, resourcesRes] = await Promise.all([
    supabase
      .from("tenants")
      .select("vertical, business_hours, owner_test_phone, language_config, a2p_status")
      .eq("id", tenantId)
      .maybeSingle(),
    readAgentConfigForPublish(supabase, tenantId),
    supabase
      .from("offerings")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("active", true),
    supabase
      .from("resources")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("active", true),
  ]);
  if (tenantRes.error || !configRead.ok) {
    return NextResponse.json({ error: "read_failed" }, { status: 500 });
  }

  const tenant = tenantRes.data;
  const config = configRead.row;
  const overrides = (config?.dynamic_variable_overrides ?? {}) as Record<string, unknown>;

  const items = computeSettingsChecklist({
    vertical: tenant?.vertical ?? "generic",
    transferNumber: config?.transfer_number ?? null,
    businessHours: tenant?.business_hours ?? null,
    activeOfferings: offeringsRes.count ?? 0,
    activeResources: resourcesRes.count ?? 0,
    delivery: overrides["delivery"] ?? null,
    ownerTestPhone: tenant?.owner_test_phone ?? null,
    textingOn: tenant?.a2p_status === "verified",
    publish: computePublishStatus({
      publishedAt: config?.published_at ?? null,
      compiledConfig: config?.compiled_config ?? null,
      transferNumber: config?.transfer_number ?? null,
      languageConfig: tenant?.language_config ?? null,
      compiledWithVersion: config?.compiled_with_version,
    }),
  });

  const required = items.filter((item) => !item.optional);
  const body: SettingsChecklistResponse = {
    items,
    requiredTotal: required.length,
    requiredDone: required.filter((item) => item.done).length,
  };
  return NextResponse.json(body);
}
