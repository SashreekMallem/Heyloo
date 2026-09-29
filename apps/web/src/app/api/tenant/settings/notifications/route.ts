import { NextResponse } from "next/server";
import {
  mergeOverrides,
  parseBody,
  requireTenantWriter,
  updateResult,
} from "@/lib/settings/route-auth";
import { notificationsRequestSchema } from "@/lib/settings/schemas";

export const runtime = "nodejs";

/**
 * `POST /api/tenant/settings/notifications` (SETTINGS-1): who the OWNER's
 * alerts go to — `agent_configs.dynamic_variable_overrides.delivery`
 * `{sms_enabled, email_enabled, alert_phone?, notification_email?}`, the
 * shape the MESSAGING-1 owner-alert fan-out reads (message taken, new
 * booking, urgent call, missed transfer). The Delivery page used to save
 * on every blur with no validation at all (any string as the email).
 *
 * Blank recipients are OMITTED rather than stored as `null`/`""`: the
 * reader's schema has them `.optional()`, and a missing value means "fall
 * back" (SMS -> transfer number, email -> the owner's sign-in email).
 */
export async function POST(request: Request) {
  const auth = await requireTenantWriter();
  if (!auth.ok) return auth.response;
  const body = await parseBody(request, notificationsRequestSchema);
  if (!body.ok) return body.response;
  const input = body.data;

  const { data: existing, error: readError } = await auth.supabase
    .from("agent_configs")
    .select("dynamic_variable_overrides")
    .eq("tenant_id", auth.tenantId)
    .maybeSingle();
  if (readError) return NextResponse.json({ error: "read_failed" }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const delivery = {
    sms_enabled: input.sms_enabled,
    email_enabled: input.email_enabled,
    ...(input.alert_phone ? { alert_phone: input.alert_phone } : {}),
    ...(input.notification_email ? { notification_email: input.notification_email } : {}),
  };

  const result = await auth.supabase
    .from("agent_configs")
    .update({
      dynamic_variable_overrides: mergeOverrides(existing.dynamic_variable_overrides, {
        delivery,
      }),
    })
    .eq("tenant_id", auth.tenantId)
    .select("id");
  const written = updateResult(result);
  if (!written.ok) return written.response;

  return NextResponse.json({ ok: true, delivery });
}
