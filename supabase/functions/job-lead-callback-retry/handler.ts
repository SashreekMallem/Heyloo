import type { SqlClient } from "../_shared/types.ts";
import type { LeadCallbackDeps } from "../api-lead-callback/handler.ts";
import {
  attemptLeadCallbackCall,
  resolveTenantCallingConfig,
} from "../api-lead-callback/handler.ts";

/**
 * FIX_REQUESTS.md — drains `lead_callback_requests` rows stuck in
 * `deferred_quiet_hours` once their `scheduled_for` has passed.
 * `api-lead-callback/handler.ts`'s `handleLeadCallback` correctly refuses
 * to place a call during a tenant's quiet hours (writing `scheduled_for`
 * = next quiet-hours-end, tenant-local) but nothing previously drained
 * that status — a deferred lead stayed `deferred_quiet_hours` forever.
 * Mirrors `job-reminder-scheduler`'s own quiet-hours-aware select-then-act
 * pattern; reuses `attemptLeadCallbackCall` (the exact same call-placing
 * logic the immediate-call path uses) rather than a second, drifting copy.
 */

interface DeferredLeadRow {
  id: string;
  tenant_id: string;
  name: string | null;
  phone_e164: string;
}

export async function findDueLeadCallbackRetries(
  sql: SqlClient,
  now: Date,
): Promise<DeferredLeadRow[]> {
  return sql<DeferredLeadRow>`
    select id, tenant_id, name, phone_e164
    from public.lead_callback_requests
    where status = 'deferred_quiet_hours' and scheduled_for <= ${now.toISOString()}::timestamptz
    order by scheduled_for asc
    limit 200
  `;
}

export type RetryOutcome =
  | "called"
  | "deferred_quiet_hours"
  | "failed_not_configured"
  | "failed_outbound_call"
  | "failed_tenant_not_found";

export async function retryOneLeadCallback(
  sql: SqlClient,
  row: DeferredLeadRow,
  deps: LeadCallbackDeps,
  now: Date,
): Promise<RetryOutcome> {
  const config = await resolveTenantCallingConfig(sql, row.tenant_id);
  if (!config) {
    // Tenant deleted/deprovisioned since the lead was deferred — nothing
    // left to retry against; leave the row as-is (already a terminal-ish
    // state a human can investigate) rather than silently deleting it.
    deps.logger.warn("lead_callback_retry_tenant_not_found", {
      lead_callback_request_id: row.id,
      tenant_id: row.tenant_id,
    });
    return "failed_tenant_not_found";
  }

  if (!config.retell_agent_id || !config.from_number || !config.disclosure_line) {
    await sql`
      update public.lead_callback_requests
      set status = 'failed', refusal_reason = 'tenant_not_configured_for_calling'
      where id = ${row.id}
    `;
    deps.logger.error("lead_callback_retry_tenant_not_configured", {
      lead_callback_request_id: row.id,
      tenant_id: row.tenant_id,
    });
    return "failed_not_configured";
  }

  const result = await attemptLeadCallbackCall(
    sql,
    row.tenant_id,
    row.id,
    row.phone_e164,
    row.name,
    {
      timezone: config.timezone,
      retell_agent_id: config.retell_agent_id,
      from_number: config.from_number,
      disclosure_line: config.disclosure_line,
    },
    deps,
    now,
  );

  if (result.status === 200) return "called";
  if (result.status === 202) return "deferred_quiet_hours";
  return "failed_outbound_call";
}

export async function runLeadCallbackRetrySweep(
  sql: SqlClient,
  deps: LeadCallbackDeps,
  now: Date = new Date(),
): Promise<Record<RetryOutcome, number> & { total: number }> {
  const rows = await findDueLeadCallbackRetries(sql, now);
  const tally: Record<RetryOutcome, number> & { total: number } = {
    called: 0,
    deferred_quiet_hours: 0,
    failed_not_configured: 0,
    failed_outbound_call: 0,
    failed_tenant_not_found: 0,
    total: rows.length,
  };
  for (const row of rows) {
    const outcome = await retryOneLeadCallback(sql, row, deps, now);
    tally[outcome] += 1;
  }
  return tally;
}
