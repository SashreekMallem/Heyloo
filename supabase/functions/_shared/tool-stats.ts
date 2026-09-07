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
 * Coordination note (docs/BUILD_NOTES.md T3 entry): targets a `tool_health`
 * table that is NOT yet in T1's migrations as of this build — BACKEND_SPEC
 * §7.2's own `DECIDE:` introduces it ("a lightweight tool_health table
 * updated async") but it isn't in MASTER_SPEC §2's explicitly-approved new-
 * table list. Shape assumed: `tool_health(id uuid pk default
 * gen_random_uuid(), tenant_id uuid, tool_name text, call_id uuid,
 * latency_ms int, success boolean, error_type text, occurred_at timestamptz
 * default now())`. T1 (or a follow-up migration) must add it; until then
 * this function's insert fails silently (caught below) and tool calls are
 * unaffected — the hot path never depends on this table existing.
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
