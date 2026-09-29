import { NextResponse } from "next/server";
import { parseBody, requireTenantWriter, updateResult } from "@/lib/settings/route-auth";
import { testPhoneRequestSchema } from "@/lib/settings/schemas";

export const runtime = "nodejs";

/**
 * `POST /api/tenant/settings/test-phone` (SETTINGS-1): `tenants.
 * owner_test_phone`, which `voice-events` compares against the caller's
 * normalized E.164 number to flag the owner's own test calls (excluded
 * from usage/billing). The Test agent page used to store whatever was
 * typed — "(555) 123-4567" never matched, so test calls were billed.
 */
export async function POST(request: Request) {
  const auth = await requireTenantWriter();
  if (!auth.ok) return auth.response;
  const body = await parseBody(request, testPhoneRequestSchema);
  if (!body.ok) return body.response;
  const ownerTestPhone = body.data.owner_test_phone ?? null;

  const result = await auth.supabase
    .from("tenants")
    .update({ owner_test_phone: ownerTestPhone })
    .eq("id", auth.tenantId)
    .select("id");
  const written = updateResult(result);
  if (!written.ok) return written.response;

  return NextResponse.json({ ok: true, owner_test_phone: ownerTestPhone });
}
