import type { SqlClient } from "../../types.ts";

export interface NumberOpsAlert {
  rule: string;
  severity: "info" | "warning" | "critical";
  tenantId: string;
  payload: Record<string, unknown>;
}

/**
 * Raises a platform ops alert (`public.alerts`, the cockpit's table) for a
 * phone-number lifecycle problem a job cannot resolve by itself. Deduped: at
 * most one OPEN alert per (rule, tenant), so a job that runs every 2 minutes
 * or daily never floods the cockpit while the condition persists.
 */
export async function raiseNumberOpsAlert(sql: SqlClient, alert: NumberOpsAlert): Promise<void> {
  await sql`
    insert into public.alerts (rule, severity, tenant_id, payload, status)
    select ${alert.rule}, ${alert.severity}, ${alert.tenantId}, ${alert.payload}::jsonb, 'open'
    where not exists (
      select 1 from public.alerts a
      where a.rule = ${alert.rule} and a.status = 'open' and a.tenant_id = ${alert.tenantId}
    )
  `;
}

/** Resolves every open alert of `rule` (e.g. when the Retell incident ends). */
export async function resolveNumberOpsAlerts(sql: SqlClient, rule: string): Promise<void> {
  await sql`
    update public.alerts set status = 'resolved' where rule = ${rule} and status = 'open'
  `;
}
