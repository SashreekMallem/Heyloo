-- OPS-8 (docs/BUILD_NOTES.md) — index `messages_outbound_queue`'s pgmq
-- table on `enqueued_at`, used by `worker-messages-outbound/handler.ts`'s
-- `sweepNotConfiguredOutbound` (deliverable 2: honest "provider not
-- configured" park+DLQ behavior). That function peeks the queue table
-- directly with a plain SELECT — deliberately never `pgmq.read`, so a
-- not-configured tick never bumps `read_ct` on a fresh message — so this
-- index keeps that peek cheap as the queue grows, same intent as pgmq's
-- own built-in index on `vt` for `pgmq.read`.
--
-- Additive, idempotent, reproducible from zero (CLAUDE.md Rule 2): guarded
-- by both the `pgmq` extension's presence and the specific queue table's
-- existence, so this is a clean no-op on a harness without pgmq (matching
-- 20260910093000_queues_and_scheduled_jobs.sql's own guard style) and
-- also a no-op if `messages_outbound_queue` hasn't been created yet by
-- that same migration for some reason.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pgmq')
     and to_regclass('pgmq.q_messages_outbound_queue') is not null then
    execute 'create index if not exists q_messages_outbound_queue_enqueued_at_idx '
      || 'on pgmq.q_messages_outbound_queue (enqueued_at)';
  else
    raise notice 'pgmq.q_messages_outbound_queue not present — skipping index (expected outside a Supabase-hosted Postgres, or before the queue migration has run)';
  end if;
end;
$$;
