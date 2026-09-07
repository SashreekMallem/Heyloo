import type { SqlClient } from "./types.js";

/**
 * Per-tool latency/error stat emission for the cockpit bottleneck view +
 * alerts (BACKEND_SPEC §7.2/§8 alert-evaluation job). Fire-and-forget from
 * the caller's perspective — `/voice-tools`'s handler never awaits this
 * inline (see voice-tools/index.ts, which wraps the call in
 * `EdgeRuntime.waitUntil` so it can't add latency to the tool-call response)
 * and this function itself swallows DB errors rather than throwing, since a
 * telemetry-write failure must never surface as a tool-call failure.
 *
 * Coordination note (docs/BUILD_NOTES.md T3/T4 entries): targets a
 * `tool_health` table added by T4's follow-up migration
 * (20260907140000_t4_tool_health_a2p_billing.sql): `tool_health(id uuid pk
 * default gen_random_uuid(), tenant_id uuid, tool_name text, call_id text,
 * latency_ms int, success boolean, error_type text, occurred_at timestamptz
 * default now())` — `call_id` is `text` (Retell's own call-id string), not
 * `uuid`, since it may not resolve to an existing `call_logs` row at
 * insert time. The insert below still fails silently (caught) so a schema
 * drift or transient DB error never affects the hot path.
 */
export interface ToolStatSample {
  tenantId: string | null;
  toolName: string;
  callId: string | null;
  latencyMs: number;
  success: boolean;
  errorType?: string;
}

export async function recordToolStat(sql: SqlClient, sample: ToolStatSample): Promise<void> {
  try {
    await sql`
      insert into public.tool_health (tenant_id, tool_name, call_id, latency_ms, success, error_type)
      values (${sample.tenantId}, ${sample.toolName}, ${sample.callId}, ${sample.latencyMs}, ${sample.success}, ${sample.errorType ?? null})
    `;
  } catch {
    // Telemetry is best-effort; never let a missing table or transient DB
    // error propagate into the hot path or an unhandled rejection.
  }
}
