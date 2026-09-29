import { NextResponse } from "next/server";
import { regenerateTenantAvailability } from "@/lib/settings/availability";
import { parseBody, requireTenantWriter, updateResult } from "@/lib/settings/route-auth";
import { businessProfileSchema } from "@/lib/settings/schemas";

export const runtime = "nodejs";

/**
 * `POST /api/tenant/settings/business` (SETTINGS-1): the business name the
 * AI announces (`{{business_name}}`, read fresh by `voice-inbound` on every
 * call) and the time zone every slot and spoken date is computed in. Both
 * were owner-invisible before (set once at checkout). A time-zone change
 * re-generates future availability right away, since existing slots were
 * built in the old zone.
 */
export async function POST(request: Request) {
  const auth = await requireTenantWriter();
  if (!auth.ok) return auth.response;
  const body = await parseBody(request, businessProfileSchema);
  if (!body.ok) return body.response;

  const { data: current } = await auth.supabase
    .from("tenants")
    .select("timezone")
    .eq("id", auth.tenantId)
    .maybeSingle();

  const result = await auth.supabase
    .from("tenants")
    .update({ name: body.data.name, timezone: body.data.timezone })
    .eq("id", auth.tenantId)
    .select("id");
  const written = updateResult(result);
  if (!written.ok) return written.response;

  const timezoneChanged = current?.timezone !== body.data.timezone;
  const availability = timezoneChanged ? await regenerateTenantAvailability(auth.tenantId) : null;

  return NextResponse.json({ ok: true, timezone_changed: timezoneChanged, availability });
}
