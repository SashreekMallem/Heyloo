-- OUTBOUND-1: 30-day retention for outbound webhook events. Additive only.
-- fn_cron_internal_retention_sweep (scheduled 05:30 UTC daily) also prunes
-- outbound_events (and, by cascade, their outbound_deliveries) after 30 days;
-- the longest retry schedule ends ~42 hours after an event. Split out of
-- 20261009120000_outbound_webhooks.sql so it can be applied on its own.

-- ---------------------------------------------------------------------
-- Retention: outbound_events (+ deliveries by cascade) after 30 days.
--    Same body as 20260910093000 (verified identical to the live function
--    2026-10-09) plus the outbound_events line.
-- ---------------------------------------------------------------------
create or replace function public.fn_cron_internal_retention_sweep()
returns void language plpgsql as $$
begin
  -- DB_AUDIT.md DB-M1: neither webhook_events (one row per webhook delivery,
  -- every provider, forever) nor tool_health (one row per /voice/tools call,
  -- the highest-write-volume table by design) had any pruning strategy.
  -- tool_health is only ever queried over trailing-minutes windows
  -- (job-alert-evaluation's tool_failure_spike rule reads the last 5
  -- minutes) so 14 days leaves enormous headroom for ad hoc debugging;
  -- webhook_events is kept longer (90 days) since it doubles as an audit
  -- trail for support/compliance investigation of a specific delivery.
  -- This is a platform-wide window (not per-tenant, unlike
  -- tenants.retention_days, which governs Storage recordings — a distinct,
  -- separately-tracked gap, see this migration's header re: cluster F).
  delete from public.webhook_events where created_at < now() - interval '90 days';
  delete from public.tool_health where occurred_at < now() - interval '14 days';
  -- OUTBOUND-1: outbound webhook events and their delivery log, 30 days (the
  -- longest retry schedule ends ~42 hours after an event).
  delete from public.outbound_events where created_at < now() - interval '30 days';
end;
$$;

comment on function public.fn_cron_internal_retention_sweep() is
  'Scheduled 05:30 UTC daily — DB_AUDIT.md DB-M1''s retention fix for webhook_events/tool_health specifically (distinct from BACKEND_SPEC §8''s Storage-recording "Retention sweep" job, which needs the Storage API and therefore an edge function — tracked separately in docs/audit/FIX_REQUESTS.md for cluster F, not scheduled here). OUTBOUND-1: also prunes outbound_events (deliveries cascade) after 30 days.';
