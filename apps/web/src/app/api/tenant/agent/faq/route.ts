import { NextResponse } from "next/server";
import {
  mergeOverrides,
  parseBody,
  requireTenantWriter,
  updateResult,
} from "@/lib/settings/route-auth";
import { faqRequestSchema } from "@/lib/settings/schemas";

export const runtime = "nodejs";

/**
 * `POST /api/tenant/agent/faq` (SETTINGS-1): Agent → FAQ, validated per
 * row against `faqItemSchema` (it existed but the tab never used it — blank
 * questions/answers were stored) plus a total-size cap. Stored at
 * `agent_configs.dynamic_variable_overrides.faq_items`; an empty list
 * removes the key. NOTE: no call-time reader exists yet (the audit found
 * `faq_items` read by nothing) — the tab says so; wiring it into
 * `voice-inbound` + the compiler is a backend follow-up in BUILD_NOTES.
 */
export async function POST(request: Request) {
  const auth = await requireTenantWriter();
  if (!auth.ok) return auth.response;
  const body = await parseBody(request, faqRequestSchema);
  if (!body.ok) return body.response;

  const { data: existing, error: readError } = await auth.supabase
    .from("agent_configs")
    .select("dynamic_variable_overrides")
    .eq("tenant_id", auth.tenantId)
    .maybeSingle();
  if (readError) return NextResponse.json({ error: "read_failed" }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const items = body.data.items.map((item) => ({
    question: item.question,
    answer: item.answer,
  }));
  const result = await auth.supabase
    .from("agent_configs")
    .update({
      dynamic_variable_overrides: mergeOverrides(existing.dynamic_variable_overrides, {
        faq_items: items.length > 0 ? items : null,
      }),
    })
    .eq("tenant_id", auth.tenantId)
    .select("id");
  const written = updateResult(result);
  if (!written.ok) return written.response;

  return NextResponse.json({ ok: true, count: items.length });
}
