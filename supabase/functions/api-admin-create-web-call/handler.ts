import type { RetellFetch } from "../_shared/providers/retell.ts";
import { createWebCall } from "../_shared/providers/retell.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";

/**
 * `api-admin-create-web-call` (CALL-5, docs/BUILD_PLAN.md — item 2 of this
 * task): internal-only sibling of `api-tenant-test-call`/
 * `api-widget-voice-token` that mints a Retell web-call `access_token` for
 * a tenant's already-published agent WITHOUT a Supabase user session or a
 * widget's signed `widget_token` — neither exists for a headless
 * Playwright-driven proof run. Guarded by the same `x-internal-secret`
 * pattern every other `api-admin-*` function in this cluster uses
 * (`PROVISION_INTERNAL_SECRET`, timing-safe compared in index.ts). Never
 * calls Twilio; never mutates anything — `createWebCall` is the only
 * Retell call made here.
 *
 * The resulting `call_logs` row is created the same way every other real
 * call's is: by `voice-events`'s own `call_started`/... webhook handlers
 * once Retell delivers them (CALL-5's own webhook_url fix is what makes
 * that actually happen now) — this function deliberately does not insert
 * a placeholder row itself, for the same "avoid a second call_logs row
 * racing the webhook" reason `api-tenant-test-call`/
 * `api-widget-voice-token` already document.
 */
export interface CreateWebCallDeps {
  retellFetch: RetellFetch;
  retellApiKey: string;
  logger: Logger;
}

export type CreateWebCallResult =
  | { status: 200; body: { access_token: string; call_id: string; agent_id: string } }
  | { status: 422; body: { error: "invalid_tenant_id" } }
  | { status: 404; body: { error: "agent_not_published" } }
  | { status: 502; body: { error: "call_token_unavailable" } };

export async function handleCreateWebCall(
  sql: SqlClient,
  rawBody: unknown,
  deps: CreateWebCallDeps,
): Promise<CreateWebCallResult> {
  const tenantId =
    typeof rawBody === "object" && rawBody !== null
      ? (rawBody as Record<string, unknown>)["tenant_id"]
      : undefined;
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    return { status: 422, body: { error: "invalid_tenant_id" } };
  }

  const rows = await sql<{ retell_agent_id: string | null; disclosure_line: string | null }>`
    select ac.retell_agent_id, at.disclosure_line
    from public.agent_configs ac
    left join public.agent_templates at on at.id = ac.template_id
    where ac.tenant_id = ${tenantId}
    limit 1
  `;
  const row = rows[0];
  if (!row?.retell_agent_id) {
    return { status: 404, body: { error: "agent_not_published" } };
  }

  const callResult = await createWebCall(deps.retellFetch, deps.retellApiKey, {
    agent_id: row.retell_agent_id,
    ...(row.disclosure_line
      ? { retell_llm_dynamic_variables: { disclosure_line: row.disclosure_line } }
      : {}),
  });
  const callBody = callResult.body as { access_token?: string; call_id?: string };
  if (!callResult.ok || !callBody.access_token || !callBody.call_id) {
    deps.logger.error("admin_create_web_call_failed", {
      tenant_id: tenantId,
      status: callResult.status,
    });
    return { status: 502, body: { error: "call_token_unavailable" } };
  }

  deps.logger.info("admin_create_web_call_started", {
    tenant_id: tenantId,
    call_id: callBody.call_id,
    agent_id: row.retell_agent_id,
  });

  return {
    status: 200,
    body: {
      access_token: callBody.access_token,
      call_id: callBody.call_id,
      agent_id: row.retell_agent_id,
    },
  };
}
