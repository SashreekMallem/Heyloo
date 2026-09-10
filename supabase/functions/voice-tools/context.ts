import type { SqlClient } from "../_shared/types.ts";

/**
 * Resolves the live call's tenant + real caller number from `call_logs` by
 * `retell_call_id` — the single indexed lookup every tool handler needs
 * before it can safely scope its query to a `tenant_id` (CLAUDE.md Rule 2:
 * "every secret-key edge function still explicitly filters by a verified
 * tenant_id"). Also the source of truth for `lookup_customer`'s
 * caller-scope check (BACKEND_SPEC §7.2, G6) — never trust `args` alone for
 * the caller's own number.
 */
export interface CallContext {
  tenantId: string;
  callLogId: string; // call_logs.id (internal uuid) — FK target for source_call_id
  retellCallId: string; // Retell's own call_id string — the idempotency-key convention's "call_id"
  callerNumber: string | null;
  /** `tenants.vertical` — resolved alongside tenant_id in the same indexed
   * join (no extra query) so tools that need vertical-specific behavior
   * (e.g. `create_booking`'s typed `structured_payload` validator,
   * GAP_REGISTER.md §1.7, and the motel deposit-hold path, §2 Motel item
   * 4) don't each re-fetch it. */
  vertical: string;
}

export async function resolveCallContext(
  sql: SqlClient,
  retellCallId: string,
): Promise<CallContext | null> {
  const rows = await sql<{
    id: string;
    tenant_id: string;
    caller_number: string | null;
    vertical: string;
  }>`
    select cl.id, cl.tenant_id, cl.caller_number, t.vertical
    from public.call_logs cl
    join public.tenants t on t.id = cl.tenant_id
    where cl.retell_call_id = ${retellCallId}
    limit 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    tenantId: row.tenant_id,
    callLogId: row.id,
    retellCallId,
    callerNumber: row.caller_number,
    vertical: row.vertical,
  };
}
