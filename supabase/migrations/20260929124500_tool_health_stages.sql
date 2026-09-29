-- HOTPATH (docs/BUILD_NOTES.md): per-stage timings for every /voice-tools
-- tool call, so the next latency measurement can attribute the part of a
-- ~1 s tool call that is not query execution (VERIFY-DEPLOY measured DB
-- execution at 0.05-23 ms per statement and could not attribute ~400-500 ms
-- from outside the function).
--
-- Written by supabase/functions/_shared/tool-stats.ts#recordToolStat (after
-- the tool response, via EdgeRuntime.waitUntil). Shape: ToolStageTimings in
-- that file — {v, region, isolate_seq, isolate_age_ms, db_warm, body_ms,
-- verify_ms, parse_ms, context_ms, tool_ms, total_ms, budget_ms, outcome,
-- prev_telemetry_ms}. NULL for rows written before this column existed or by
-- a function version that predates it; recordToolStat falls back to the old
-- column list if this migration has not been applied yet, so apply order
-- relative to the voice-tools deploy does not matter.
--
-- Additive and nullable: no default, no backfill, no rewrite of existing
-- rows. RLS is already enabled on tool_health with no client policies
-- (20260909130000_tool_health_rls.sql); a new column inherits that.

alter table public.tool_health add column if not exists stages jsonb;

comment on column public.tool_health.stages is
  'HOTPATH per-stage timings (ms) for one /voice-tools call: region (SB_REGION), isolate_seq, isolate_age_ms, db_warm, body_ms, verify_ms, parse_ms, context_ms, tool_ms, total_ms, budget_ms, outcome, prev_telemetry_ms. See supabase/functions/_shared/tool-stats.ts ToolStageTimings.';
