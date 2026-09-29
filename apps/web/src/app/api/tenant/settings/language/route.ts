import { NextResponse } from "next/server";
import { languageChangePendingSince, publishedLanguage } from "@/lib/settings/publish-status";
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
 * can. Backend readers only read `->>'primary'`, so the extra keys are
 * inert to them. Saving the same language again does not re-stamp.
 *
 * SETTINGS-1 review:
 * - The first change after a publish also records `published_primary` —
 *   the language the live agent was built with — so switching back to it
 *   no longer shows "You changed the call language" (a revert needs no
 *   publish). Later unpublished changes carry that value forward.
 * - Other `language_config` keys are kept instead of the whole object
 *   being replaced.
 */
export async function POST(request: Request) {
  const auth = await requireTenantWriter();
  if (!auth.ok) return auth.response;
  const body = await parseBody(request, languageRequestSchema);
  if (!body.ok) return body.response;

  const [tenantRes, configRes] = await Promise.all([
    auth.supabase.from("tenants").select("language_config").eq("id", auth.tenantId).maybeSingle(),
    auth.supabase
      .from("agent_configs")
      .select("published_at")
      .eq("tenant_id", auth.tenantId)
      .maybeSingle(),
  ]);
  if (tenantRes.error || configRes.error) {
    return NextResponse.json({ error: "read_failed" }, { status: 500 });
  }
  if (!tenantRes.data) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const raw = tenantRes.data.language_config as unknown;
  const existing =
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  if (existing["primary"] === body.data.primary) {
    return NextResponse.json({ ok: true, changed: false });
  }

  const publishedAt = configRes.data?.published_at ?? null;
  const livePrimary = languageChangePendingSince(existing, publishedAt)
    ? publishedLanguage(existing)
    : typeof existing["primary"] === "string"
      ? existing["primary"]
      : null;

  const rest = { ...existing };
  delete rest["published_primary"];
  const languageConfig = {
    ...rest,
    primary: body.data.primary,
    bilingual: typeof existing["bilingual"] === "boolean" ? existing["bilingual"] : false,
    changed_at: new Date().toISOString(),
    ...(livePrimary ? { published_primary: livePrimary } : {}),
  };
  const result = await auth.supabase
    .from("tenants")
    // `changed_at`/`published_primary` are not on the hand-maintained
    // `TenantRow.language_config` type (packages/supabase-client).
    .update({ language_config: languageConfig as { primary: string; bilingual: boolean } })
    .eq("id", auth.tenantId)
    .select("id");
  const written = updateResult(result);
  if (!written.ok) return written.response;

  return NextResponse.json({ ok: true, changed: true });
}
