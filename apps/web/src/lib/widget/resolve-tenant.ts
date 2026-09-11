import "server-only";

import { createSupabaseServiceRoleServerClient } from "@/lib/supabase/service-role";
import { isOriginAllowed, parseWidgetSettings, type WidgetSettings } from "./settings-schema";

/**
 * The single choke point BACKEND_SPEC.md §13.2's "two independent checks"
 * flow through — `widget_public_key` (an exact row match, not itself a
 * secret) AND the request's `Origin` header against that tenant's own
 * `widget_settings.allowed_origins`. Used by both `GET /api/widget/config`
 * and `POST /api/widget/session` so there is exactly one implementation of
 * this gate, not two that could drift. Service-role read (RLS bypass) is
 * required here — there is no authenticated tenant session at all on this
 * public, unauthenticated surface — but every query below still explicitly
 * filters by the verified `widget_public_key` row match (CLAUDE.md Rule 2:
 * "every secret-key edge function still explicitly filters by a verified
 * tenant_id" — this route's equivalent since it has no JWT tenant_id to
 * filter by yet).
 */
export interface WidgetTenantContext {
  tenantId: string;
  businessName: string;
  settings: WidgetSettings;
}

export async function resolveWidgetTenant(
  widgetPublicKey: string,
  origin: string | null,
): Promise<WidgetTenantContext | null> {
  if (!widgetPublicKey) return null;

  const service = createSupabaseServiceRoleServerClient();
  const { data } = await service
    .from("tenants")
    .select("id, name, widget_enabled, widget_settings")
    .eq("widget_public_key", widgetPublicKey)
    .is("deleted_at", null)
    .maybeSingle();

  if (!data?.widget_enabled) return null;

  const settings = parseWidgetSettings(data.widget_settings);
  if (!isOriginAllowed(origin, settings.allowed_origins)) return null;

  return { tenantId: data.id as string, businessName: (data.name as string) ?? "", settings };
}
