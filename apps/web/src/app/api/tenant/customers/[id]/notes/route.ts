import { customerNoteSchema } from "@heyloo/canonical-types";
import { NextResponse } from "next/server";
import { claimsFromSupabaseClient } from "@/lib/auth/claims";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Customer detail "log a note" (FRONTEND_SPEC.md §6.5 — "a lightweight
 * `customer_notes` free-text field, not a full ticket"). NOT backed by a
 * dedicated `customer_notes` table: no such table exists in the actual
 * schema (`supabase/migrations/*.sql` has no `customer_notes` migration —
 * flagged in docs/VERIFY.md). Stored as an appended entry in
 * `customers.metadata.notes[]` instead (appended atomically by the
 * `fn_append_customer_note` SQL function), which the same RLS write policy
 * already covers, rather than inventing a new table in a package outside
 * T5's exclusive paths.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  // AUTH-1 fix (docs/BUILD_NOTES.md, SIGNUP-1 root cause #3): claims live
  // only in the JWT itself, never in the User/session object's
  // app_metadata; claimsFromUser(user) always evaluated to {} for a real
  // tenant/admin/partner here.
  const claims = await claimsFromSupabaseClient(supabase);
  if (!claims.tenant_id) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = customerNoteSchema.safeParse({
    customer_id: id,
    note: (json as { note?: unknown }).note,
  });
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 422 });

  // One atomic SQL statement appends the note (fn_append_customer_note): the old
  // read-modify-write of the whole metadata JSON lost concurrent notes and any
  // concurrent metadata write (QA-1 F-05). The function runs with the caller's
  // RLS and only touches the customer of the JWT's tenant.
  const { data: appended, error } = await supabase.rpc("fn_append_customer_note", {
    p_customer_id: id,
    p_body: parsed.data.note,
  });
  if (error) return NextResponse.json({ error: "update_failed" }, { status: 500 });
  if (!appended) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
