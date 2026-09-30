import { NextResponse } from "next/server";
import { parseBody, requireTenantWriter, updateResult } from "@/lib/settings/route-auth";
import { widgetRequestSchema } from "@/lib/settings/widget-settings";

export const runtime = "nodejs";

/**
 * `POST /api/tenant/settings/widget` (QA-1 F-13): the Website widget page's
 * on/off switch and its settings (`tenants.widget_enabled`,
 * `tenants.widget_settings`). It used to write the browser form straight to
 * the table with no validation; now the accent must be hex, at least one
 * mode must be on, and origins are normalized (lower-case https, unique, no
 * wildcards) before they are stored. Owner/admin only, like every settings
 * write; a write RLS filtered to zero rows is a 404.
 */
export async function POST(request: Request) {
  const auth = await requireTenantWriter();
  if (!auth.ok) return auth.response;
  const body = await parseBody(request, widgetRequestSchema);
  if (!body.ok) return body.response;

  const result = await auth.supabase
    .from("tenants")
    .update({
      ...(body.data.widget_enabled !== undefined
        ? { widget_enabled: body.data.widget_enabled }
        : {}),
      ...(body.data.widget_settings ? { widget_settings: body.data.widget_settings } : {}),
    })
    .eq("id", auth.tenantId)
    .select("id");
  const written = updateResult(result);
  if (!written.ok) return written.response;
  return NextResponse.json({ ok: true, widget_settings: body.data.widget_settings ?? null });
}
