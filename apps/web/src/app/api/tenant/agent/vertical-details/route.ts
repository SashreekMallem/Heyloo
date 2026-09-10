import { verticalDetailsSchema } from "@heyloo/canonical-types";
import { NextResponse } from "next/server";
import { claimsFromUser } from "@/lib/auth/claims";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Agent settings → Vertical details tab save (MASTER_SPEC.md §3.5/§3.10).
 * Server-side validated against `verticalDetailsSchema` (unlike the other
 * agent-settings tabs, which validate client-side only via `zodResolver` —
 * this tab's fields feed the voice agent's per-vertical behavior directly,
 * so a bad value reaching `agent_configs.dynamic_variable_overrides`
 * unvalidated is a live-call risk, not just a cosmetic one). Merges into
 * the existing overrides object rather than replacing it — the AI
 * Instructions tab writes sibling keys (`manager_name`, `parking_info`,
 * etc.) into the same jsonb column.
 */
export async function POST(request: Request) {
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

  const parsed = verticalDetailsSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const { data: existing } = await supabase
    .from("agent_configs")
    .select("dynamic_variable_overrides")
    .eq("tenant_id", claims.tenant_id)
    .maybeSingle();

  const overrides = (existing?.dynamic_variable_overrides ?? {}) as Record<string, unknown>;

  const { error } = await supabase
    .from("agent_configs")
    .update({ dynamic_variable_overrides: { ...overrides, ...parsed.data } })
    .eq("tenant_id", claims.tenant_id);

  if (error) return NextResponse.json({ error: "update_failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
