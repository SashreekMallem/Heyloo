import { NextResponse } from "next/server";
import {
  fromUntypedTable,
  requireAdminApiSession,
  writeAdminAction,
} from "@/app/api/admin/_lib/admin-auth";
import {
  partnerVerticalOverrideSchema,
  VERTICAL_OVERRIDE_VERTICALS,
} from "@/app/api/admin/_lib/referral-partner-schema";
import { createSupabaseServiceRoleServerClient } from "@/lib/supabase/service-role";

export const runtime = "nodejs";

type Params = { id: string; vertical: string };

/** Per-vertical commission override (Cluster H task brief item 4 — any NULL column here falls back to the partner-level value, never a platform default, per the migration's own comment). */
export async function PUT(request: Request, { params }: { params: Promise<Params> }) {
  const session = await requireAdminApiSession();
  if (!session.ok) return session.response;
  const { id, vertical } = await params;
  if (!(VERTICAL_OVERRIDE_VERTICALS as readonly string[]).includes(vertical)) {
    return NextResponse.json({ error: "unknown_vertical" }, { status: 422 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = partnerVerticalOverrideSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const supabase = createSupabaseServiceRoleServerClient();
  const { data: partner } = await supabase
    .from("referral_partners")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (!partner) return NextResponse.json({ error: "partner_not_found" }, { status: 404 });

  const { data: before } = await fromUntypedTable(supabase, "referral_partner_vertical_overrides")
    .select("*")
    .eq("referral_partner_id", id)
    .eq("vertical", vertical)
    .maybeSingle();

  const { data: after, error } = await fromUntypedTable(
    supabase,
    "referral_partner_vertical_overrides",
  )
    .upsert(
      {
        referral_partner_id: id,
        vertical,
        rate_bps: parsed.data.rate_bps ?? null,
        commission_base: parsed.data.commission_base ?? null,
        duration_months: parsed.data.duration_months ?? null,
      },
      { onConflict: "referral_partner_id,vertical" },
    )
    .select("*")
    .maybeSingle();
  if (error || !after) return NextResponse.json({ error: "upsert_failed" }, { status: 500 });

  await writeAdminAction({
    adminUserId: session.adminUserId,
    action: "referral_partner_vertical_override_edit",
    targetType: "referral",
    targetId: id,
    before: (before as unknown as Record<string, unknown>) ?? null,
    after: after as unknown as Record<string, unknown>,
  });

  return NextResponse.json({ override: after });
}

export async function DELETE(_request: Request, { params }: { params: Promise<Params> }) {
  const session = await requireAdminApiSession();
  if (!session.ok) return session.response;
  const { id, vertical } = await params;

  const supabase = createSupabaseServiceRoleServerClient();
  const { data: before } = await fromUntypedTable(supabase, "referral_partner_vertical_overrides")
    .select("*")
    .eq("referral_partner_id", id)
    .eq("vertical", vertical)
    .maybeSingle();
  if (!before) return NextResponse.json({ ok: true });

  const { error } = await fromUntypedTable(supabase, "referral_partner_vertical_overrides")
    .delete()
    .eq("referral_partner_id", id)
    .eq("vertical", vertical);
  if (error) return NextResponse.json({ error: "delete_failed" }, { status: 500 });

  await writeAdminAction({
    adminUserId: session.adminUserId,
    action: "referral_partner_vertical_override_delete",
    targetType: "referral",
    targetId: id,
    before: before as unknown as Record<string, unknown>,
    after: null,
  });

  return NextResponse.json({ ok: true });
}
