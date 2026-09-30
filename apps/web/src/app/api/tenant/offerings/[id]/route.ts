import { NextResponse } from "next/server";
import { parseBody, requireTenantWriter, updateResult } from "@/lib/settings/route-auth";
import { offeringUpdateSchema } from "../schema";

export const runtime = "nodejs";

/**
 * QA-1 SEC-07: owner/admin only (`requireTenantWriter` -> 403
 * `owner_or_admin_required`), and an update RLS filtered to zero rows is a
 * 404 rather than `{ok: true}` — a `member`'s edit used to be silently
 * dropped by the `offerings_write` policy while the route reported success.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireTenantWriter();
  if (!auth.ok) return auth.response;
  const body = await parseBody(request, offeringUpdateSchema);
  if (!body.ok) return body.response;

  const result = await auth.supabase
    .from("offerings")
    .update(body.data)
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .select("id");
  const written = updateResult(result);
  if (!written.ok) return written.response;
  return NextResponse.json({ ok: true });
}

/** Soft delete only — `offerings` is referenced by `bookings`/`orders`
 * line items (no cascade); deactivating hides it from booking/ordering
 * without breaking past records. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireTenantWriter();
  if (!auth.ok) return auth.response;

  const result = await auth.supabase
    .from("offerings")
    .update({ active: false })
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .select("id");
  const written = updateResult(result);
  if (!written.ok) return written.response;
  return NextResponse.json({ ok: true });
}
