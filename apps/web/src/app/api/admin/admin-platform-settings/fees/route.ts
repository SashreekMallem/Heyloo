import { VERTICALS } from "@heyloo/canonical-types";
import { NextResponse } from "next/server";
import { requireAdminApiSession, writeAdminAction } from "@/app/api/admin/_lib/admin-auth";
import { DEFAULT_FEES, platformFeesSchema } from "@/app/api/admin/_lib/fees-schema";
import { createSupabaseServiceRoleServerClient } from "@/lib/supabase/service-role";

export const runtime = "nodejs";

/**
 * Admin Platform Settings "Fees" tab (Cluster H task brief item 5). Static
 * route at `/api/admin/admin-platform-settings/fees` shadows the generic
 * `api/admin/[...path]/route.ts` proxy for this one path — the edge
 * function's `handlePlatformSettings` (outside this cluster's ownership)
 * only knows `referral`/`pricing`; this reads/writes the `fees_<vertical>`
 * `platform_settings` keys directly, same posture (service role +
 * `platform_admin` claim + `admin_actions` audit trail) as its sibling
 * `referral`/`pricing` routes there.
 */
export async function GET() {
  const session = await requireAdminApiSession();
  if (!session.ok) return session.response;

  const supabase = createSupabaseServiceRoleServerClient();
  const { data, error } = await supabase
    .from("platform_settings")
    .select("key, value")
    .in(
      "key",
      VERTICALS.map((v) => `fees_${v}`),
    );
  if (error) return NextResponse.json({ error: "query_failed" }, { status: 500 });

  const byKey = new Map((data ?? []).map((r) => [r.key, r.value as Record<string, unknown>]));
  const fees = Object.fromEntries(
    VERTICALS.map((v) => [v, { ...DEFAULT_FEES, ...(byKey.get(`fees_${v}`) ?? {}) }]),
  );
  return NextResponse.json({ fees });
}

export async function POST(request: Request) {
  const session = await requireAdminApiSession();
  if (!session.ok) return session.response;

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = platformFeesSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_fees", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const supabase = createSupabaseServiceRoleServerClient();
  const key = `fees_${parsed.data.vertical}`;
  const { data: beforeRow } = await supabase
    .from("platform_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();

  const { vertical, ...value } = parsed.data;
  const { error } = await supabase
    .from("platform_settings")
    .upsert({ key, value, updated_by: session.adminUserId } as never, { onConflict: "key" });
  if (error) return NextResponse.json({ error: "save_failed" }, { status: 500 });

  await writeAdminAction({
    adminUserId: session.adminUserId,
    action: "platform_settings_fees_edit",
    targetType: "other",
    targetId: vertical,
    before: (beforeRow?.value as Record<string, unknown>) ?? null,
    after: value,
  });

  return NextResponse.json({ vertical, fees: value });
}
