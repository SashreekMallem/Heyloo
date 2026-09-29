import { NextResponse } from "next/server";
import { regenerateTenantAvailability } from "@/lib/settings/availability";
import { parseBody, requireTenantWriter, updateResult } from "@/lib/settings/route-auth";
import { businessProfileSchema } from "@/lib/settings/schemas";
import {
  checkTimezoneKnownToDatabase,
  TIMEZONE_NOT_SUPPORTED_MESSAGE,
} from "@/lib/settings/timezone-db";

export const runtime = "nodejs";

/**
 * `POST /api/tenant/settings/business` (SETTINGS-1): the business name the
 * AI announces (`{{business_name}}`, read fresh by `voice-inbound` on every
 * call) and the time zone every slot and spoken date is computed in. Both
 * were owner-invisible before (set once at checkout). A time-zone change
 * re-generates future availability right away, since existing slots were
 * built in the old zone.
 *
 * SETTINGS-1 review: a NEW zone must also be known to Postgres, not just to
 * Node's ICU — see `lib/settings/timezone-db.ts` (one unknown zone would
 * abort the nightly slot roll-forward for every tenant).
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
  const timezoneChanged = current?.timezone !== body.data.timezone;

  if (timezoneChanged) {
    const known = await checkTimezoneKnownToDatabase(
      auth.supabase,
      auth.tenantId,
      body.data.timezone,
    );
    if (known === "unknown") {
      return NextResponse.json(
        {
          error: "invalid_request",
          issues: [{ path: ["timezone"], message: TIMEZONE_NOT_SUPPORTED_MESSAGE }],
        },
        { status: 422 },
      );
    }
    if (known === "error") {
      return NextResponse.json({ error: "read_failed" }, { status: 500 });
    }
  }

  const result = await auth.supabase
    .from("tenants")
    .update({ name: body.data.name, timezone: body.data.timezone })
    .eq("id", auth.tenantId)
    .select("id");
  const written = updateResult(result);
  if (!written.ok) return written.response;

  const availability = timezoneChanged ? await regenerateTenantAvailability(auth.tenantId) : null;

  return NextResponse.json({ ok: true, timezone_changed: timezoneChanged, availability });
}
