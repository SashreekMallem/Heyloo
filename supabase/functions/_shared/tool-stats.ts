import type { ToolCall } from "./schemas/voice-tools.ts";
import type { SqlClient } from "./types.ts";

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
/**
 * OPS-5 (docs/BUILD_NOTES.md — dental showed zero `tool_health` rows
 * despite 4/4 passing tests, and 60 pre-existing rows logged with
 * `tenant_id: null`). Root cause, confirmed live: every Retell batch-test/
 * chat-completion/playground tool call shares the exact SAME literal
 * `call_id`, `"playground"` (`voice-tools/context.ts`'s own docstring —
 * read, never edited, for this investigation). `call_logs` is unique on
 * `retell_call_id`, so the FIRST tenant ever to run a batch test against
 * that literal id wins a real row permanently; `resolveCallContext`'s
 * cached-row lookup (its path (a)) then returns THAT tenant for every
 * later batch-test call from ANY tenant, forever — confirmed via a live
 * query: exactly one `call_logs` row for `retell_call_id = 'playground'`,
 * owned by the `auto` test tenant (its very first-ever batch test,
 * chronologically before `dental` existed), and 275 `tool_health` rows
 * under that same tenant_id vs. zero under dental's — dental's batch-test
 * tool calls were being silently misattributed to `auto` the whole time,
 * not dropped. (The 60 `tenant_id: null` rows are separately explained:
 * they predate CALL-2/CALL-5's tenant-resolution fixes entirely — from
 * before `resolveTenantFromPayload` could resolve a batch-test call at
 * all, so no `call_logs` row was ever created for them, current-code
 * artifacts of history rather than an ongoing gap.)
 *
 * This is a `tool_health`-ATTRIBUTION fix only, deliberately scoped away
 * from `voice-tools/context.ts` (owned by a concurrent task this task must
 * not edit) — the underlying `call_logs` collision (and therefore which
 * tenant a batch-test call's actual booking/DB writes land under) is
 * unchanged and remains open, flagged in `docs/BUILD_NOTES.md`'s OPS-5
 * entry for that task to pick up. What this DOES fix, independently and
 * safely: `api-admin-run-agent-tests` sets
 * `retell_llm_dynamic_variables.heyloo_tenant_id` to the REAL tenant under
 * test on every single scenario it runs (`api-admin-run-agent-tests/
 * handler.ts`) — a per-call signal carried on the tool-call payload
 * itself, never cached, so it can never collide the way the shared
 * `call_logs` row does. Preferring it here (when present) over the
 * possibly-stale resolved `tenantId` means the health metric is tagged
 * correctly regardless of the collision. A REAL call never sets this
 * dynamic variable at all (`context.ts`'s own confirmed finding — no
 * caller/Retell-inbound path can set it), so this is a no-op for
 * production traffic: `resolvedTenantId` (`ctx.tenantId`, unchanged) is
 * used exactly as before for every non-test call.
 */
export function resolveTelemetryTenantId(
  resolvedTenantId: string | null,
  call: ToolCall | undefined,
): string | null {
  const dynamicVars = call?.retell_llm_dynamic_variables;
  const testHarnessTenantId =
    dynamicVars && typeof dynamicVars["heyloo_tenant_id"] === "string"
      ? dynamicVars["heyloo_tenant_id"]
      : null;
  return testHarnessTenantId || resolvedTenantId;
}

/**
 * HOTPATH (docs/BUILD_NOTES.md): per-stage timings for one `/voice-tools`
 * request, stored on the `tool_health.stages` jsonb column
 * (`20260929124500_tool_health_stages.sql`) and echoed as a `Server-Timing`
 * response header, so the next measurement can attribute the part of a tool
 * call that is NOT query execution (VERIFY-DEPLOY: ~400-500 ms per call
 * could not be attributed from outside). All `*_ms` values are wall-clock
 * milliseconds measured inside the isolate, rounded to 0.1 ms.
 *
 * - `region`: `SB_REGION`, the AWS region the function executed in
 *   (supabase.com/docs/guides/functions/regional-invocation). The DB is in
 *   us-east-2; anything else means every round trip crosses regions.
 * - `isolate_seq` / `isolate_age_ms`: 1 / small = a freshly booted isolate.
 * - `db_warm`: the isolate's (single, hot-path) DB connection was already
 *   open, i.e. this call did not pay TCP + TLS + SCRAM + `fetch_types`.
 * - `body_ms` (reading the request body), `verify_ms` (Retell HMAC),
 *   `parse_ms` (JSON + envelope validation), `context_ms`
 *   (`resolveCallContext`), `tool_ms` (tool body incl. arg validation),
 *   `total_ms` (request start -> response built). `latency_ms` on the row
 *   keeps its historical meaning (dispatch only) so old/new rows compare.
 * - `budget_ms`: the per-tool deadline in force; `outcome`: see
 *   `voice-tools/handler.ts#DispatchOutcome`.
 * - `prev_telemetry_ms`: how long the PREVIOUS `tool_health` insert on this
 *   isolate took (the insert runs after the response, via
 *   `EdgeRuntime.waitUntil`, so it cannot time itself into its own row).
 */
export interface ToolStageTimings {
  v: 1;
  region: string | null;
  isolate_seq: number;
  isolate_age_ms: number;
  db_warm: boolean;
  body_ms: number;
  verify_ms: number;
  parse_ms: number;
  context_ms: number | null;
  tool_ms: number | null;
  total_ms: number;
  budget_ms: number | null;
  outcome: string;
  prev_telemetry_ms: number | null;
}

/** Rounds a millisecond duration to 0.1 ms (never negative). */
export function roundMs(ms: number): number {
  return Math.max(0, Math.round(ms * 10) / 10);
}

/**
 * `Server-Timing` header value (W3C Server Timing: `name;dur=<ms>` entries,
 * comma-separated) for the stages that were actually measured. Cheap string
 * work only; a stage that never ran (`null`) is omitted.
 */
export function serverTimingHeader(stages: ToolStageTimings): string {
  const entries: [string, number | null][] = [
    ["body", stages.body_ms],
    ["verify", stages.verify_ms],
    ["parse", stages.parse_ms],
    ["context", stages.context_ms],
    ["tool", stages.tool_ms],
    ["total", stages.total_ms],
  ];
  const parts = entries
    .filter((e): e is [string, number] => e[1] !== null)
    .map(([name, dur]) => `${name};dur=${roundMs(dur)}`);
  parts.push(`db;desc="${stages.db_warm ? "warm" : "cold"}"`);
  if (stages.region) parts.push(`region;desc="${stages.region}"`);
  return parts.join(", ");
}

export interface ToolStatSample {
  tenantId: string | null;
  toolName: string;
  callId: string | null;
  latencyMs: number;
  success: boolean;
  errorType?: string;
  stages?: ToolStageTimings;
}

const UNDEFINED_COLUMN = "42703";

// Set once per isolate if `tool_health.stages` does not exist yet (the
// function was deployed before `20260929124500_tool_health_stages.sql` was
// applied) so later inserts skip straight to the column list that works.
let stagesColumnMissing = false;

/** Test-only: resets the per-isolate "stages column missing" memo. */
export function resetToolStatMemoForTests(): void {
  stagesColumnMissing = false;
}

export async function recordToolStat(sql: SqlClient, sample: ToolStatSample): Promise<void> {
  try {
    if (sample.stages && !stagesColumnMissing) {
      try {
        await sql`
          insert into public.tool_health (tenant_id, tool_name, call_id, latency_ms, success, error_type, stages)
          values (${sample.tenantId}, ${sample.toolName}, ${sample.callId}, ${sample.latencyMs}, ${sample.success}, ${sample.errorType ?? null}, ${sample.stages}::jsonb)
        `;
        return;
      } catch (err) {
        if ((err as { code?: string } | null)?.code !== UNDEFINED_COLUMN) throw err;
        // Migration not applied yet: remember it and fall through to the
        // pre-HOTPATH column list, so the latency row is still recorded.
        stagesColumnMissing = true;
      }
    }
    await sql`
      insert into public.tool_health (tenant_id, tool_name, call_id, latency_ms, success, error_type)
      values (${sample.tenantId}, ${sample.toolName}, ${sample.callId}, ${sample.latencyMs}, ${sample.success}, ${sample.errorType ?? null})
    `;
  } catch {
    // Telemetry is best-effort; never let a missing table or transient DB
    // error propagate into the hot path or an unhandled rejection.
  }
}
