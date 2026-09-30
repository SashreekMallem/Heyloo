import { NextResponse } from "next/server";
import { regenerateTenantAvailability } from "@/lib/settings/availability";
import {
  checkNotHeylooNumber,
  HEYLOO_NUMBER_MESSAGE,
  syncTransferNumberToBusinessPhone,
} from "@/lib/settings/business-phone";
import { parseBody, requireTenantWriter, updateResult } from "@/lib/settings/route-auth";
import { businessProfileRequestSchema } from "@/lib/settings/schemas";
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
 *
 * LAUNCH-forwarding: also the business phone (E.164, US/Canada, never the
 * tenant's own Heyloo number) and website. A changed business phone carries
 * the agent's transfer number along while it is still the default
 * (`lib/settings/business-phone.ts`). Both keys are optional in the body: a
 * client that omits them leaves the stored values alone.
 */
export async function POST(request: Request) {
  const auth = await requireTenantWriter();
  if (!auth.ok) return auth.response;
  const body = await parseBody(request, businessProfileRequestSchema);
  if (!body.ok) return body.response;
  const { name, timezone, business_phone: businessPhone, website_url: websiteUrl } = body.data;

  const { data: current } = await auth.supabase
    .from("tenants")
    .select("timezone, business_phone")
    .eq("id", auth.tenantId)
    .maybeSingle();
  const timezoneChanged = current?.timezone !== timezone;
  const previousPhone = current?.business_phone ?? null;

  if (timezoneChanged) {
    const known = await checkTimezoneKnownToDatabase(auth.supabase, auth.tenantId, timezone);
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

  if (businessPhone && businessPhone !== previousPhone) {
    const allowed = await checkNotHeylooNumber(auth.supabase, auth.tenantId, businessPhone);
    if (allowed === "heyloo_number") {
      return NextResponse.json(
        {
          error: "invalid_request",
          issues: [{ path: ["business_phone"], message: HEYLOO_NUMBER_MESSAGE }],
        },
        { status: 422 },
      );
    }
    if (allowed === "error") return NextResponse.json({ error: "read_failed" }, { status: 500 });
  }

  const result = await auth.supabase
    .from("tenants")
    .update({
      name,
      timezone,
      ...(businessPhone !== undefined ? { business_phone: businessPhone } : {}),
      ...(websiteUrl !== undefined ? { website_url: websiteUrl } : {}),
    })
    .eq("id", auth.tenantId)
    .select("id");
  const written = updateResult(result);
  if (!written.ok) return written.response;

  const transferNumberUpdated =
    businessPhone !== undefined
      ? await syncTransferNumberToBusinessPhone(
          auth.supabase,
          auth.tenantId,
          previousPhone,
          businessPhone,
        )
      : false;
  const availability = timezoneChanged ? await regenerateTenantAvailability(auth.tenantId) : null;

  return NextResponse.json({
    ok: true,
    timezone_changed: timezoneChanged,
    availability,
    transfer_number_updated: transferNumberUpdated,
  });
}
