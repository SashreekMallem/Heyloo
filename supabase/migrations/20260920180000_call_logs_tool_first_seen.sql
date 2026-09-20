-- CALL-2 (docs/BUILD_NOTES.md): voice-tools' hot-path context resolver can
-- now create a call_logs row itself, the first time it sees a call_id with
-- no existing row (a Retell batch-test/chat/playground session, or a real
-- inbound call whose tool call raced ahead of voice-events' call_started
-- webhook) — see voice-tools/context.ts#resolveCallContext. Two additive
-- changes support that:
--
-- 1. call_logs.source distinguishes a webhook-created row from this
--    best-effort placeholder, so voice-events' own call_started handler
--    knows it's safe to backfill/overwrite a placeholder row with the
--    webhook's authoritative data (fixed in that handler, not here) without
--    ever touching a row that already came from a real call_started event.
-- 2. agent_configs.retell_agent_id has no index today (confirmed via
--    migration audit) even though voice-events' resolveTenantForCall
--    already filters by it on the web_voice fallback path, and
--    voice-tools' new fallback now does too — both are hot/warm paths, not
--    a one-off admin query.

alter table public.call_logs
  add column source text not null default 'call_started'
    check (source in ('call_started', 'tool_first_seen'));

comment on column public.call_logs.source is
  'call_started = created by voice-events''s call_started (or out-of-order call_ended) webhook handler, the normal path. tool_first_seen = created by voice-tools/context.ts#resolveCallContext when a tool call for an unknown call_id resolves a tenant from the tool payload itself (agent_id/to_number) before any call_logs row existed — a Retell batch-test/chat/playground session (no real call_started webhook ever fires for those), or the real-call race where the first tool call lands before voice-events has committed call_started''s row. voice-events''s call_started handler upserts over a tool_first_seen row (never a call_started one) to backfill it with the webhook''s authoritative data once it arrives.';

create index idx_agent_configs_retell_agent_id
  on public.agent_configs (retell_agent_id)
  where retell_agent_id is not null;
