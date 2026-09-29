import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApiSession, writeAdminAction } from "@/app/api/admin/_lib/admin-auth";
import { createSupabaseServiceRoleServerClient } from "@/lib/supabase/service-role";

export const runtime = "nodejs";

/** Mirrors the `referral_partners.w9_status` CHECK constraint. */
const w9StatusSchema = z.object({ w9_status: z.enum(["not_submitted", "submitted", "verified"]) });

/**
 * `PATCH /api/admin/admin-referral-partners/[id]/w9` (PT-04): the only writer
 * of `referral_partners.w9_status` — there is no W-9 provider integration yet,
 * so a partner emails their W-9 to support and an admin records it here. The
 * payout job holds partners past the $600 YTD threshold until this is
 * `verified`. `w9_status` is not a column partners can write themselves
 * (column grants, `20260929160000_lock_owner_writes_to_editable_columns.sql`),
 * so this admin-gated service-role write is the only path. Audited.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminApiSession();
  if (!session.ok) return session.response;
  const { id } = await params;

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = w9StatusSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const supabase = createSupabaseServiceRoleServerClient();
  const { data: before } = await supabase
    .from("referral_partners")
    .select("id, w9_status")
    .eq("id", id)
    .maybeSingle();
  if (!before) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { data: after, error } = await supabase
    .from("referral_partners")
    .update({ w9_status: parsed.data.w9_status })
    .eq("id", id)
    .select("id, w9_status")
    .maybeSingle();
  if (error || !after) return NextResponse.json({ error: "update_failed" }, { status: 500 });

  await writeAdminAction({
    adminUserId: session.adminUserId,
    action: "referral_partner_w9_status_set",
    targetType: "referral",
    targetId: id,
    before: before as unknown as Record<string, unknown>,
    after: after as unknown as Record<string, unknown>,
  });

  return NextResponse.json({ partner: after });
}
