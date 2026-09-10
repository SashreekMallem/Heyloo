import { NextResponse } from "next/server";
import { requireAdminApiSession, writeAdminAction } from "@/app/api/admin/_lib/admin-auth";
import { createSupabaseServiceRoleServerClient } from "@/lib/supabase/service-role";

export const runtime = "nodejs";

type TicketStatus = "open" | "pending" | "resolved" | "closed";
const VALID_STATUSES: readonly TicketStatus[] = ["open", "pending", "resolved", "closed"];
function isTicketStatus(value: string): value is TicketStatus {
  return (VALID_STATUSES as readonly string[]).includes(value);
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminApiSession();
  if (!session.ok) return session.response;
  const { id } = await params;

  const supabase = createSupabaseServiceRoleServerClient();
  const { data: ticket } = await supabase
    .from("support_requests")
    .select(
      "id, tenant_id, subject, body, priority, status, call_id, booking_id, created_at, updated_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (!ticket) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { data: tenant } = await supabase
    .from("tenants")
    .select("name, vertical")
    .eq("id", ticket.tenant_id)
    .maybeSingle();

  const { data: notes } = await supabase
    .from("support_request_notes")
    .select("id, body, visible_to_tenant, created_at, author_id")
    .eq("support_request_id", id)
    .order("created_at", { ascending: true });

  return NextResponse.json({
    ticket: {
      ...ticket,
      tenant_name: tenant?.name ?? "—",
      tenant_vertical: tenant?.vertical ?? null,
    },
    notes: notes ?? [],
  });
}

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
  const statusInput = (json as { status?: unknown })?.status;
  if (typeof statusInput !== "string" || !isTicketStatus(statusInput)) {
    return NextResponse.json({ error: "invalid_status" }, { status: 422 });
  }
  const status = statusInput;

  const supabase = createSupabaseServiceRoleServerClient();
  const { data: before } = await supabase
    .from("support_requests")
    .select("id, status")
    .eq("id", id)
    .maybeSingle();
  if (!before) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { data: after, error } = await supabase
    .from("support_requests")
    .update({ status })
    .eq("id", id)
    .select("id, status")
    .maybeSingle();
  if (error || !after) return NextResponse.json({ error: "update_failed" }, { status: 500 });

  await writeAdminAction({
    adminUserId: session.adminUserId,
    action: "support_request_status_change",
    targetType: "support_request",
    targetId: id,
    before,
    after,
  });

  return NextResponse.json({ ticket: after });
}
