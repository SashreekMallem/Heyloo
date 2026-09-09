import type { RetellFetch } from "../_shared/providers/retell.ts";
import { getCall } from "../_shared/providers/retell.ts";
import { RetellCallObjectSchema } from "../_shared/schemas/voice-events.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";
import { handleCallAnalyzed } from "../voice-events/handler.ts";

/**
 * Nightly `get-call` reconciliation job (BACKEND_SPEC §8): for every
 * `call_logs` row older than 15 minutes with `classification is null` (the
 * `call_analyzed` webhook never arrived — `call_started`/`call_ended`
 * already landed, since duration/timestamps are what makes a row "stale"
 * rather than absent), re-fetch Retell's `get-call` and backfill via
 * `/voice-events`'s own `handleCallAnalyzed` (reused, not duplicated —
 * SYSTEM_DESIGN §2/§8). Deliberately does NOT also call `handleCallEnded`
 * here: that path inserts `cost_events`/`usage_events` and enqueues a
 * recording-fetch unconditionally on every call, which already happened
 * off the (successfully-delivered) `call_ended` webhook — re-running it
 * would double-count cost/usage and re-enqueue an already-fetched
 * recording.
 */
export interface ReconciliationDeps {
  retellFetch: RetellFetch;
  retellApiKey: string;
  logger: Logger;
}

interface StaleCallRow {
  id: string;
  retell_call_id: string;
  tenant_id: string;
}

export async function findStaleCalls(
  sql: SqlClient,
  olderThanMinutes = 15,
): Promise<StaleCallRow[]> {
  return sql<StaleCallRow>`
    select id, retell_call_id, tenant_id
    from public.call_logs
    where classification is null
      and started_at < now() - (${olderThanMinutes} || ' minutes')::interval
    order by started_at asc
    limit 200
  `;
}

export async function reconcileOneCall(
  sql: SqlClient,
  row: StaleCallRow,
  deps: ReconciliationDeps,
): Promise<boolean> {
  const result = await getCall(deps.retellFetch, deps.retellApiKey, row.retell_call_id);
  if (!result.ok) {
    deps.logger.warn("reconciliation_get_call_failed", {
      call_id: row.retell_call_id,
      status: result.status,
    });
    return false;
  }

  const parsed = RetellCallObjectSchema.safeParse(result.body);
  if (!parsed.success) {
    deps.logger.warn("reconciliation_get_call_bad_shape", { call_id: row.retell_call_id });
    return false;
  }

  await handleCallAnalyzed(sql, parsed.data, deps.logger);
  return true;
}
