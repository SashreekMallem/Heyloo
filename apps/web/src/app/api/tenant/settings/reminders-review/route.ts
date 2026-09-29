import { NextResponse } from "next/server";
import { parseBody, requireTenantWriter, updateResult } from "@/lib/settings/route-auth";
import { reminderReviewRequestSchema } from "@/lib/settings/schemas";

export const runtime = "nodejs";

/**
 * Agent settings → Vertical details tab: reminders/review toggles +
 * `review_url` + avg-ticket field (MASTER_SPEC.md §3.6/§3.8/§3.9/§3.10),
 * server-side validated against `reminderReviewSettingsSchema` and written
 * to the real `tenants` columns (`voice_reminders_enabled`,
 * `review_request_enabled`, `review_url`, `avg_transaction_value_cents`).
 *
 * SETTINGS-1: `reminderReviewRequestSchema` (`lib/settings/schemas.ts`) —
 * blank link clears it, http(s) only, and review requests need a link.
 *
 * QA-1 SEC-07: owner/admin only (`requireTenantWriter`) and a write RLS
 * filtered to zero rows is a 404 — a `member`'s POST used to answer
 * `{ok: true}` while `tenants_update` silently dropped it.
 */
export async function POST(request: Request) {
  const auth = await requireTenantWriter();
  if (!auth.ok) return auth.response;
  const body = await parseBody(request, reminderReviewRequestSchema);
  if (!body.ok) return body.response;

  const result = await auth.supabase
    .from("tenants")
    .update({
      voice_reminders_enabled: body.data.voice_reminders_enabled,
      review_request_enabled: body.data.review_request_enabled,
      review_url: body.data.review_url,
      avg_transaction_value_cents: body.data.avg_transaction_value_cents,
    })
    .eq("id", auth.tenantId)
    .select("id");
  const written = updateResult(result);
  if (!written.ok) return written.response;
  return NextResponse.json({ ok: true });
}
