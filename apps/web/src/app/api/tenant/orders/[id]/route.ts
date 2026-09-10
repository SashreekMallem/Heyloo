import { NextResponse } from "next/server";
import { z } from "zod";
import { claimsFromUser } from "@/lib/auth/claims";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const bodySchema = z.object({
  status: z.enum(["received", "confirmed", "preparing", "ready", "completed", "cancelled"]),
});

/** Order status transition from the Orders detail page (E2E_FLOWS_AUDIT.md Flow 5, MASTER_SPEC.md §3.0/§3.10). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const claims = claimsFromUser(user);
  if (!claims.tenant_id) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 422 });

  const { data: order, error: fetchError } = await supabase
    .from("orders")
    .select("id")
    .eq("id", id)
    .eq("tenant_id", claims.tenant_id)
    .maybeSingle();
  if (fetchError || !order) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { error } = await supabase
    .from("orders")
    .update({ status: parsed.data.status })
    .eq("id", id)
    .eq("tenant_id", claims.tenant_id);
  if (error) return NextResponse.json({ error: "update_failed" }, { status: 500 });

  return NextResponse.json({ ok: true });
}
