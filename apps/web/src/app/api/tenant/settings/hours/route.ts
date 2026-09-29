import { NextResponse } from "next/server";
import { regenerateTenantAvailability } from "@/lib/settings/availability";
import { hoursPayloadSchema, toStoredExceptions, toStoredHours } from "@/lib/settings/hours";
import { parseBody, requireTenantWriter, updateResult } from "@/lib/settings/route-auth";

export const runtime = "nodejs";

/**
 * `POST /api/tenant/settings/hours` (SETTINGS-1): weekly hours + holiday /
 * special-hours exceptions, validated server-side (the Hours tab used to
 * write the raw editor state straight through the browser client) and
 * stored in the canonical shape every backend reader expects — see
 * `lib/settings/hours.ts` for why the old shape made "closed" days
 * bookable and a blank exception date could abort the nightly rollforward.
 *
 * Then rebuilds this tenant's future availability immediately (the old
 * toast promised "~30s" but slots only changed at the 04:00 UTC cron).
 * Motels skip it: their slot generator books whole nights and ignores
 * hours entirely.
 */
export async function POST(request: Request) {
  const auth = await requireTenantWriter();
  if (!auth.ok) return auth.response;
  const body = await parseBody(request, hoursPayloadSchema);
  if (!body.ok) return body.response;

  const result = await auth.supabase
    .from("tenants")
    .update({
      business_hours: toStoredHours(body.data.hours),
      hours_exceptions: toStoredExceptions(body.data.exceptions),
    })
    .eq("id", auth.tenantId)
    .select("id, vertical");
  const written = updateResult(result);
  if (!written.ok) return written.response;

  const vertical = Array.isArray(result.data) ? result.data[0]?.vertical : undefined;
  const availability =
    vertical === "motel" ? null : await regenerateTenantAvailability(auth.tenantId);

  return NextResponse.json({ ok: true, availability });
}
