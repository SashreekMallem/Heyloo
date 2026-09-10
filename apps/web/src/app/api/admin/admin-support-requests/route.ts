import { NextResponse } from "next/server";
import { requireAdminApiSession } from "@/app/api/admin/_lib/admin-auth";
import { createSupabaseServiceRoleServerClient } from "@/lib/supabase/service-role";

export const runtime = "nodejs";

type TicketStatus = "open" | "pending" | "resolved" | "closed";
const VALID_STATUSES: readonly TicketStatus[] = ["open", "pending", "resolved", "closed"];
function isTicketStatus(value: string): value is TicketStatus {
  return (VALID_STATUSES as readonly string[]).includes(value);
}

/**
 * Admin cockpit ticket queue (FRONTEND_SPEC.md — Cluster H task brief item
 * 3). `supabase/functions/admin/handler.ts` lists `admin-support-requests`
 * in its own `NOT_YET_IMPLEMENTED_PREFIXES` (returns 501) — that file is
 * outside this cluster's ownership, so this Route Handler implements the
 * queue directly against Postgres (service role) rather than waiting on
 * it; see `docs/audit/FIX_REQUESTS.md` for the request to fold this into
 * the edge function later for consistency with the rest of `/api/admin/*`.
 * `platform_admin`-gated the same way `api/admin/[...path]/route.ts` is.
 */
export async function GET(request: Request) {
  const session = await requireAdminApiSession();
  if (!session.ok) return session.response;

  const status = new URL(request.url).searchParams.get("status");
  const supabase = createSupabaseServiceRoleServerClient();

  let query = supabase
    .from("support_requests")
    .select("id, tenant_id, subject, priority, status, created_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(200);

  if (status && isTicketStatus(status)) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }

  const tenantIds = [...new Set((data ?? []).map((r) => r.tenant_id))];
  const { data: tenants } =
    tenantIds.length > 0
      ? await supabase.from("tenants").select("id, name").in("id", tenantIds)
      : { data: [] as { id: string; name: string }[] };
  const nameById = new Map((tenants ?? []).map((t) => [t.id, t.name]));

  return NextResponse.json({
    rows: (data ?? []).map((r) => ({ ...r, tenant_name: nameById.get(r.tenant_id) ?? "—" })),
  });
}
