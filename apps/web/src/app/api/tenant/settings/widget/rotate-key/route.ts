import { NextResponse } from "next/server";
import { requireTenantWriter, updateResult } from "@/lib/settings/route-auth";

export const runtime = "nodejs";

/**
 * `POST /api/tenant/settings/widget/rotate-key` (QA-1 F-13): issues a new
 * `tenants.widget_public_key`. The key is generated here, server-side (the
 * page used to mint one with `Math.random()` when `crypto.randomUUID` was
 * missing). The old key stops working immediately, so the page asks for
 * confirmation before calling this. Owner/admin only.
 */
export async function POST() {
  const auth = await requireTenantWriter();
  if (!auth.ok) return auth.response;

  const widgetPublicKey = `pk_${crypto.randomUUID().replaceAll("-", "")}`;
  const result = await auth.supabase
    .from("tenants")
    .update({ widget_public_key: widgetPublicKey })
    .eq("id", auth.tenantId)
    .select("id");
  const written = updateResult(result);
  if (!written.ok) return written.response;
  return NextResponse.json({ ok: true, widget_public_key: widgetPublicKey });
}
