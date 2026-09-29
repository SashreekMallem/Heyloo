import { NextResponse } from "next/server";
import { parseBody, requireTenantWriter, updateResult } from "@/lib/settings/route-auth";
import { languageRequestSchema } from "@/lib/settings/schemas";

export const runtime = "nodejs";

/**
 * `POST /api/tenant/settings/language` (SETTINGS-1): the AI's spoken call
 * language (`tenants.language_config.primary`). Unlike almost every other
 * owner setting it is baked into the PUBLISHED agent (the verbatim opening
 * line and Retell's agent-level language are chosen at compile time,
 * `_shared/provisioning/compile-and-publish.ts`), so a change needs
 * "Publish changes". It lives on `tenants`, which PUBLISH-1's
 * `agent_configs.updated_at` badge could never see — this stamps
 * `language_config.changed_at` so `GET /api/tenant/agent/publish-status`
 * can. Backend readers only read `->>'primary'`, so the extra key is inert
 * to them. Saving the same language again does not re-stamp.
 */
export async function POST(request: Request) {
  const auth = await requireTenantWriter();
  if (!auth.ok) return auth.response;
  const body = await parseBody(request, languageRequestSchema);
  if (!body.ok) return body.response;

  const { data: current, error: readError } = await auth.supabase
    .from("tenants")
    .select("language_config")
    .eq("id", auth.tenantId)
    .maybeSingle();
  if (readError) return NextResponse.json({ error: "read_failed" }, { status: 500 });
  if (!current) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const existing = (current.language_config ?? {}) as Record<string, unknown>;
  if (existing["primary"] === body.data.primary) {
    return NextResponse.json({ ok: true, changed: false });
  }

  const languageConfig = {
    primary: body.data.primary,
    bilingual: false,
    changed_at: new Date().toISOString(),
  };
  const result = await auth.supabase
    .from("tenants")
    // `changed_at` is not on the hand-maintained `TenantRow.language_config`
    // type (packages/supabase-client, outside this task's ownership).
    .update({ language_config: languageConfig as { primary: string; bilingual: boolean } })
    .eq("id", auth.tenantId)
    .select("id");
  const written = updateResult(result);
  if (!written.ok) return written.response;

  return NextResponse.json({ ok: true, changed: true });
}
