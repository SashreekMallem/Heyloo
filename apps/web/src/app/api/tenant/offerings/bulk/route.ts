import { NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, requireTenantWriter } from "@/lib/settings/route-auth";
import { offeringWriteSchema } from "../schema";

export const runtime = "nodejs";

/**
 * Confirms a batch of offerings after the tenant reviews a menu import
 * (dashboard/setup/offerings/import) — the import endpoint itself only
 * PARSES a menu into candidate rows (GAP_REGISTER.md §4 Cluster E "menu
 * import UI calling cluster G's api-menu-import"), it never writes
 * `offerings` directly; this route is the one write path, reusing the same
 * per-row validation as a single create so a bulk-imported row can never
 * skip it. Capped at 200 rows/request — a real menu/room list, not an
 * accidental unbounded payload.
 *
 * QA-1 SEC-07: owner/admin only (a member's import used to fail RLS as a 500).
 */
const bulkSchema = z.object({
  offerings: z.array(offeringWriteSchema).min(1).max(200),
});

export async function POST(request: Request) {
  const auth = await requireTenantWriter();
  if (!auth.ok) return auth.response;
  const body = await parseBody(request, bulkSchema);
  if (!body.ok) return body.response;

  const rows = body.data.offerings.map((o) => ({ ...o, tenant_id: auth.tenantId }));
  const { data, error } = await auth.supabase.from("offerings").insert(rows).select("id");
  if (error) return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  return NextResponse.json({ ok: true, created: data?.length ?? 0 });
}
