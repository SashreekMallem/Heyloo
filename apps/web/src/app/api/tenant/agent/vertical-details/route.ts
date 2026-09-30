import { NextResponse } from "next/server";
import {
  mergeOverrides,
  parseBody,
  requireTenantWriter,
  updateResult,
} from "@/lib/settings/route-auth";
import { verticalDetailsRequestSchema } from "@/lib/settings/schemas";

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
 *
 * SETTINGS-1: validated against `verticalDetailsRequestSchema`
 * (`lib/settings/schemas.ts`) — the canonical schema plus E.164 contact
 * phones and `null`-to-clear for every optional field (merged with
 * `mergeOverrides`, which deletes a key sent as `null`).
 *
 * QA-1 SEC-07: owner/admin only (`requireTenantWriter`); a write RLS
 * filtered to zero rows is a 404, not `{ok: true}`.
 */
export async function POST(request: Request) {
  const auth = await requireTenantWriter();
  if (!auth.ok) return auth.response;
  const { supabase, tenantId } = auth;
  const body = await parseBody(request, verticalDetailsRequestSchema);
  if (!body.ok) return body.response;

  const { data: existing } = await supabase
    .from("agent_configs")
    .select("dynamic_variable_overrides")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const result = await supabase
    .from("agent_configs")
    .update({
      dynamic_variable_overrides: mergeOverrides(existing?.dynamic_variable_overrides, body.data),
    })
    .eq("tenant_id", tenantId)
    .select("tenant_id");
  const written = updateResult(result);
  if (!written.ok) return written.response;

  // FIX_REQUESTS.md — `tenants.policies_reviewed_at`: a real, timestamped
  // "reviewed" signal for the setup-progress panel, set the moment a
  // tenant owner/admin actually saves this form with a non-empty
  // cancellation_policy.text (an explicit acknowledgment action, not just
  // an inferred proxy). Best-effort — never fails the save itself.
  if (body.data.cancellation_policy?.text) {
    const { error: reviewedError } = await supabase
      .from("tenants")
      .update({ policies_reviewed_at: new Date().toISOString() })
      .eq("id", tenantId);
    if (reviewedError) {
      console.error("policies_reviewed_at update failed", reviewedError);
    }
  }

  return NextResponse.json({ ok: true });
}
