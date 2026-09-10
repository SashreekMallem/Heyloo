import type { RetellFetch } from "../_shared/providers/retell.ts";
import { createWebCall } from "../_shared/providers/retell.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";

/**
 * `/api-tenant-test-call` core logic (docs/audit/FIX_REQUESTS.md — the
 * web-call half of the dashboard's "test your agent" page; the phone-call
 * half works today with no new backend). Resolves the CALLING tenant's own
 * already-published `agent_configs.retell_agent_id` (never a body param —
 * CLAUDE.md Rule 2, `tenant_id` from the verified JWT only) and starts a
 * Retell web-call session against it, reusing the SAME `createWebCall`
 * helper `api-demo-agent/handler.ts` already uses for the pre-signup demo
 * flow — just against the tenant's real published agent instead of a demo
 * template. Provider isolation (Rule 2) is exactly why this can't be built
 * from `apps/web` directly (see that cluster's proxy route, already built
 * and tested against this contract).
 */

export interface TenantTestCallDeps {
  retellFetch: RetellFetch;
  retellApiKey: string;
  logger: Logger;
}

export type TenantTestCallResult =
  | { status: 200; body: { access_token: string; call_id: string } }
  | { status: 404; body: { error: "agent_not_published" } }
  | { status: 502; body: { error: "call_token_unavailable" } };

export async function handleTenantTestCall(
  sql: SqlClient,
  tenantId: string,
  deps: TenantTestCallDeps,
): Promise<TenantTestCallResult> {
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
    deps.logger.error("tenant_test_call_web_call_failed", {
      tenant_id: tenantId,
      status: callResult.status,
    });
    return { status: 502, body: { error: "call_token_unavailable" } };
  }

  // A web call has no caller PSTN number to match against
  // `tenants.owner_test_phone` — `is_test_call: true` unconditionally, per
  // this entry's own contract. The real `call_logs` row for the actual
  // conversation is otherwise created by `voice-events`'s existing webhook
  // path (same as every other call) once Retell's own events arrive; this
  // insert is a placeholder-free no-op today — deliberately NOT duplicated
  // here to avoid a second, possibly-conflicting `call_logs` row racing
  // that webhook.
  deps.logger.info("tenant_test_call_web_call_started", {
    tenant_id: tenantId,
    call_id: callBody.call_id,
  });

  return { status: 200, body: { access_token: callBody.access_token, call_id: callBody.call_id } };
}
