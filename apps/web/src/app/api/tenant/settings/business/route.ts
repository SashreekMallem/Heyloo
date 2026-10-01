import { NextResponse } from "next/server";
import { regenerateTenantAvailability } from "@/lib/settings/availability";
import { isAddressComplete } from "@/lib/settings/business-address";
import { type BusinessLocation, locateBusiness } from "@/lib/settings/business-location";
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
 *
 * DELIVERY-1: also the business street address and, for a restaurant, the
 * delivery radius (miles) and delivery charge (dollars in, integer cents
 * stored). Same optional-key rule. A save that changed the address asks the
 * `api-tenant-business-location` edge function to locate it right away, so
 * the response says whether it was found (`business_location`). Delivery keys
 * sent for a non-restaurant tenant are ignored.
 */
export async function POST(request: Request) {
  const auth = await requireTenantWriter();
  if (!auth.ok) return auth.response;
  const body = await parseBody(request, businessProfileRequestSchema);
  if (!body.ok) return body.response;
  const { name, timezone, business_phone: businessPhone, website_url: websiteUrl } = body.data;

  const { data: current } = await auth.supabase
    .from("tenants")
    .select(
      "timezone, business_phone, vertical, business_street, business_city, business_state, business_zip",
    )
    .eq("id", auth.tenantId)
    .maybeSingle();
  const address = {
    business_street: body.data.business_street,
    business_city: body.data.business_city,
    business_state: body.data.business_state,
    business_zip: body.data.business_zip,
  };
  const addressPatch = Object.fromEntries(
    Object.entries(address).filter(([, value]) => value !== undefined),
  );
  const addressChanged = Object.entries(addressPatch).some(
    ([key, value]) => (current?.[key as keyof typeof address] ?? null) !== value,
  );
  const deliveryPatch = current?.vertical === "restaurant" ? deliveryColumns(body.data) : {};
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
      ...addressPatch,
      ...deliveryPatch,
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

  let businessLocation: BusinessLocation | null = null;
  if (addressChanged) {
    const saved = {
      street:
        address.business_street !== undefined ? address.business_street : current?.business_street,
      city: address.business_city !== undefined ? address.business_city : current?.business_city,
      state:
        address.business_state !== undefined ? address.business_state : current?.business_state,
      zip: address.business_zip !== undefined ? address.business_zip : current?.business_zip,
    };
    if (isAddressComplete(saved)) {
      const {
        data: { session },
      } = await auth.supabase.auth.getSession();
      businessLocation = session
        ? await locateBusiness(session.access_token)
        : { error: "lookup_unavailable" };
    } else if (Object.values(saved).some((v) => (v ?? "").length > 0)) {
      businessLocation = { error: "address_incomplete" };
    }
  }

  return NextResponse.json({
    ok: true,
    timezone_changed: timezoneChanged,
    availability,
    transfer_number_updated: transferNumberUpdated,
    business_location: businessLocation,
  });
}

/** DELIVERY-1: request fields -> `tenants` delivery columns (only the keys that were sent). */
function deliveryColumns(data: {
  delivery_radius_miles?: number | null | undefined;
  delivery_fee_base?: number | null | undefined;
  delivery_fee_per_mile?: number | null | undefined;
  delivery_fee_included_miles?: number | null | undefined;
  delivery_min_order?: number | null | undefined;
}): Record<string, number | null> {
  const miles = (hundredths: number | null) => (hundredths === null ? null : hundredths / 100);
  const out: Record<string, number | null> = {};
  if (data.delivery_radius_miles !== undefined) {
    out["delivery_radius_miles"] = miles(data.delivery_radius_miles);
  }
  if (data.delivery_fee_base !== undefined) out["delivery_fee_base_cents"] = data.delivery_fee_base;
  if (data.delivery_fee_per_mile !== undefined) {
    out["delivery_fee_per_mile_cents"] = data.delivery_fee_per_mile;
  }
  if (data.delivery_fee_included_miles !== undefined) {
    out["delivery_fee_included_miles"] = miles(data.delivery_fee_included_miles);
  }
  if (data.delivery_min_order !== undefined)
    out["delivery_min_order_cents"] = data.delivery_min_order;
  return out;
}
