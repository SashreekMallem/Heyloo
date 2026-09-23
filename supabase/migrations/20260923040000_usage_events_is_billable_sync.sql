-- FOLLOWUP-1 (docs/BUILD_NOTES.md QA-BILL/FOLLOWUP-1): keep
-- usage_events.is_billable in sync with call_logs.is_test_call FOREVER,
-- not just at the moment voice-events/handler.ts#handleCallEnded first
-- writes the usage_events row.
--
-- Root cause (docs/BUILD_NOTES.md QA-BILL's own flagged finding, one real
-- row: call_logs.is_test_call=true but usage_events.is_billable=true):
-- `handleCallEnded` computes `is_billable = not is_test_call` from a single
-- snapshot of `call_logs.is_test_call` taken AT INSERT TIME. But
-- `is_test_call` can still change on that same row AFTER the usage_events
-- row already exists — the documented out-of-order-delivery race
-- (voice-events/handler.ts's own header: "tolerant of out-of-order
-- delivery (call_ended before call_started)"): when `call_ended` arrives
-- first, `handleCallEnded`'s own fallback insert (lines ~209-229) resolves
-- `is_test_call` itself and writes the usage_events row against THAT
-- value; when the correct `call_started` webhook lands afterward, its own
-- upsert unconditionally overwrites `call_logs.is_test_call` with its own
-- (authoritative) determination (`on conflict do update set is_test_call =
-- excluded.is_test_call`) — but nothing ever re-touches the already-
-- written usage_events row, so a mismatch persists indefinitely. The same
-- gap applies to any other future direct update of call_logs.is_test_call
-- (e.g. an admin data-quality correction) — not just this one race.
--
-- Fix: a trigger, not another one-shot snapshot in application code, so
-- ANY future change to call_logs.is_test_call (regardless of which code
-- path causes it) keeps every one of that call's usage_events rows
-- correct, permanently — matching how trg_call_logs_cost_rollup already
-- keeps call_logs.cost_cents in sync with cost_events (functions_triggers
-- migration, §4). Guarded by `when (old.is_test_call is distinct from
-- new.is_test_call)` so it only actually runs on a genuine value change —
-- never on a no-op `on conflict do update` (the exact anti-pattern
-- QA-HOT's own hot-path latency fix root-caused for trg_broadcast_call_logs
-- firing on every ON CONFLICT match regardless of whether any column
-- value changed). voice-events processing is background work
-- (EdgeRuntime.waitUntil), not the /voice/tools hot path, so this trigger
-- never touches the p95<500ms budget (CLAUDE.md Rule 2) either way.
--
-- NOT APPLIED to the live project from this sandbox (DDL blocked here,
-- CLAUDE.md/task instructions) — see docs/BUILD_NOTES.md FOLLOWUP-1 for
-- who needs to apply it and how to verify.

create or replace function public.fn_sync_usage_events_is_billable()
returns trigger
language plpgsql as $$
begin
  update public.usage_events
  set is_billable = not new.is_test_call
  where call_id = new.id
    and is_billable is distinct from (not new.is_test_call);
  return new;
end;
$$;

comment on function public.fn_sync_usage_events_is_billable() is
  'FOLLOWUP-1: keeps every usage_events row for a call in sync with call_logs.is_test_call whenever it changes after the usage row was already written (out-of-order call_started/call_ended webhook delivery, or any later correction) — never lets a test call stay billable or a real call stay excluded from billing.';

create trigger trg_call_logs_sync_usage_billable
  after update of is_test_call on public.call_logs
  for each row
  when (old.is_test_call is distinct from new.is_test_call)
  execute function public.fn_sync_usage_events_is_billable();
