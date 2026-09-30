import { NextResponse } from "next/server";
import {
  checkNotHeylooNumber,
  HEYLOO_NUMBER_MESSAGE,
  syncTransferNumberToBusinessPhone,
} from "@/lib/settings/business-phone";
import { parseBody, requireTenantWriter, updateResult } from "@/lib/settings/route-auth";
import { businessPhoneRequestSchema } from "@/lib/settings/schemas";

export const runtime = "nodejs";

/**
 * `POST /api/tenant/settings/business-phone` (LAUNCH-forwarding): the phone
 * setup screen's inline "Your business phone" save. Same rules as the
 * business phone on Agent → Business (`../business/route.ts`) — friendly
 * input normalized to E.164 (US/Canada), never the tenant's own Heyloo
 * number, and the agent's transfer number follows it while it is still the
 * default — without that form's required name/time zone. Owner/admin only,
 * scoped to the JWT tenant; the write goes through RLS and the tenants
 * column allow-list (business_phone is owner-editable).
 */
export async function POST(request: Request) {
  const auth = await requireTenantWriter();
  if (!auth.ok) return auth.response;
  const body = await parseBody(request, businessPhoneRequestSchema);
  if (!body.ok) return body.response;
  const businessPhone = body.data.business_phone;

  const { data: current, error: readError } = await auth.supabase
    .from("tenants")
    .select("business_phone")
    .eq("id", auth.tenantId)
    .maybeSingle();
  if (readError) return NextResponse.json({ error: "read_failed" }, { status: 500 });
  const previousPhone = current?.business_phone ?? null;

  if (businessPhone !== previousPhone) {
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
    .update({ business_phone: businessPhone })
    .eq("id", auth.tenantId)
    .select("id");
  const written = updateResult(result);
  if (!written.ok) return written.response;

  const transferNumberUpdated = await syncTransferNumberToBusinessPhone(
    auth.supabase,
    auth.tenantId,
    previousPhone,
    businessPhone,
  );

  return NextResponse.json({
    ok: true,
    business_phone: businessPhone,
    transfer_number_updated: transferNumberUpdated,
  });
}
