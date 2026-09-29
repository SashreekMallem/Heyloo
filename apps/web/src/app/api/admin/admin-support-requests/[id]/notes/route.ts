import { NextResponse } from "next/server";
import { requireAdminApiSession } from "@/app/api/admin/_lib/admin-auth";
import { createSupabaseServiceRoleServerClient } from "@/lib/supabase/service-role";

export const runtime = "nodejs";

/**
 * Admin note on a ticket. A reply to the tenant by default (`visible_to_tenant`
 * true); `{ visible_to_tenant: false }` stores an internal note the tenant never
 * sees (COCKPIT-F25).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminApiSession();
  if (!session.ok) return session.response;
  const { id } = await params;

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const { body, visible_to_tenant: visibleInput } = (json ?? {}) as {
    body?: unknown;
    visible_to_tenant?: unknown;
  };
  if (typeof body !== "string" || body.trim().length === 0) {
    return NextResponse.json({ error: "empty_body" }, { status: 422 });
  }
  if (visibleInput !== undefined && typeof visibleInput !== "boolean") {
    return NextResponse.json({ error: "invalid_visible_to_tenant" }, { status: 422 });
  }
  const visibleToTenant = visibleInput ?? true;

  const supabase = createSupabaseServiceRoleServerClient();
  const { data: ticket } = await supabase
    .from("support_requests")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (!ticket) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { data: note, error } = await supabase
    .from("support_request_notes")
    .insert({
      support_request_id: id,
      author_id: session.adminUserId,
      body: body.trim(),
      visible_to_tenant: visibleToTenant,
    })
    .select("id, body, visible_to_tenant, created_at, author_id")
    .maybeSingle();
  if (error || !note) return NextResponse.json({ error: "insert_failed" }, { status: 500 });

  return NextResponse.json({ note });
}
