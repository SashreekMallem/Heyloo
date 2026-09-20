-- OPS-2 (docs/BUILD_NOTES.md) — cut chronic pg_cron -> pg_net timeouts.
-- Additive follow-up to 20260910093000_queues_and_scheduled_jobs.sql; never
-- edit that (or any other already-applied migration) after being applied
-- (CLAUDE.md Rule 2). Reuses its exact guard structure. Idempotent:
-- `cron.schedule`/`fn_cron_upsert` upsert by job name, `create or replace
-- function` is a plain replace — safe to re-run, reproducible from zero.
--
-- ===========================================================================
-- EVIDENCE (sbq.sh against the live project, 2026-09-20 10:00-16:00 UTC,
-- net._http_response, ~1542 rows / 6h):
--   status_code  200: 31   500: 591   401: 452   null(timeout): 468
--   timeout error_msg: "Timeout of 15000 ms reached" x448, "...30000 ms" x19,
--     "...45000 ms" x1 (matches the three timeout_milliseconds values used
--     across the 25 scheduled jobs).
--   Of the 15000ms timeouts, DNS time == the full 15000ms (resolver never
--     returned) for ~30% (133/446 sampled); the rest show DNS time ~0ms with
--     the stall instead in TCP/SSL handshake or HTTP response wait — i.e.
--     "DNS-stall" is one symptom of a broader, ongoing timeout pattern, not
--     a separate root cause.
--   Timeout RATE is flat to inversely correlated with job-schedule overlap,
--     which rules out a concurrency/thundering-herd cause:
--       no overlap (only the 3 per-minute workers fire):        39.8% timeout
--       overlaps 2-min + 3-min job too:                          26.1% timeout
--       every-2/3/5-min AND the three */15 AND three hourly
--         "0 * * * *" jobs all coincide (worst case, minute 0/30,
--         ~12 requests fired in the same instant):                10.8% timeout
--     (query: bucket net._http_response rows by request-time-mod-{2,3,5,15}
--     using created minus the parsed "Total time" from error_msg; full query
--     in this task's scratchpad, reproducible against net._http_response).
--   pg_net settings: pg_net.batch_size=200, pg_net.ttl=6 hours,
--     pg_net.database_name=postgres, pg_net.username='' (all defaults except
--     batch_size, which is already generous next to the ~12-request worst
--     case above). net.http_request_queue depth = 0 (not backed up).
--   => Not a batch_size/backlog problem, not a concurrency/collision
--   problem, and the fraction is chronic across all 6 sampled hours
--   (74-84 timeouts/hour, ~30-35% of that hour's calls, every hour) rather
--   than tied to any particular time or job pairing.
--
-- CITED CAUSE (CLAUDE.md Rule 1 — verified against current sources this
-- session, not from memory):
--   - pg_net's own README (github.com/supabase/pg_net, fetched 2026-09-20):
--     "employs a single background worker" that reads
--     net.http_request_queue and executes requests via libcurl; no
--     multi-worker / concurrency config exists — `pg_net.batch_size` only
--     bounds rows read per pass. One shared libcurl (and its DNS resolver
--     state) serves every request from every job.
--   - curl/curl#18216 (github.com/curl/curl/issues/18216, closed, filed
--     2025-08-07, affects curl 8.5.0/8.14.1/8.15.0): after a DNS lookup
--     times out and libcurl calls ares_cancel(), "the ares channel itself
--     stays in an invalid state, with its internal socket still open but
--     not operable" — it does NOT self-recover, and curl_easy_reset() does
--     not clear it; the only fix is discarding the handle (a fresh
--     process/worker). This exactly matches what's measured above: once
--     the single pg_net worker's shared resolver state gets corrupted by
--     one timed-out lookup, a flat ~30% of ALL subsequent requests through
--     that same worker keep failing regardless of how many jobs happen to
--     coincide, until the worker itself restarts.
--   - github.com/orgs/supabase/discussions/36235 ("DB Trigger Failing with
--     DNS Error - pg_net cannot resolve host") and pg_net's own exposed
--     `net.worker_restart()` (confirmed present via `pg_proc` on the live
--     project, pg_net 0.19.5, owned by supabase_admin, EXECUTE already
--     granted to the `postgres` role that owns every existing cron.job
--     here) — restarting the worker is the documented recovery path when
--     PG_NET >= 0.8 (we are on 0.19.5): it reloads pg_net's config and
--     restarts the background worker, which drops the stuck libcurl/c-ares
--     handle and starts a fresh one. supabase.com/docs/guides/database/
--     extensions/pg_net (fetched 2026-09-20) documents `worker_restart()`'s
--     signature but frames it only as a config-reload helper; the
--     DNS-recovery use here is corroborated by the above discussion and by
--     curl#18216's own "the only workaround is a fresh handle" conclusion,
--     not asserted from memory alone — flagged in docs/BUILD_NOTES.md OPS-2
--     as the one inference beyond a direct doc statement.
--   - supabase.com/docs/guides/troubleshooting/webhook-debugging-guide-M8sk47
--     (fetched 2026-09-20) documents a DIFFERENT, already-patched (pg_net
--     v0.11+, we are on 0.19.5) "mass timeout from request-volume
--     intensity" bug and recommends raising the caller's timeout for THAT
--     case — evidence above (flat/inverse correlation with concurrency)
--     rules this out as our cause, so this migration deliberately does NOT
--     raise timeout_milliseconds or stagger schedules (CLAUDE.md Rule 1:
--     the numbers must support the choice, not just an available knob).
--
-- DECISION: (d) — apply the documented worker-restart recovery path on a
-- recurring pg_cron schedule (DB-internal call to net.worker_restart()
-- itself, no HTTP round trip, no Vault secret dependency), rather than (a)
-- batch_size, (b) per-job timeout increases, or (c) staggering — the
-- evidence rules out (a)/(c) directly and (b) treats a symptom (the
-- request that happens to be in flight when the channel is already broken)
-- rather than the cause. Every 10 minutes: frequent enough that a
-- corrupted resolver state is only ever a few worker-restart cycles old
-- (bounding how long the ~30% failure rate can persist), infrequent enough
-- not to itself interrupt healthy in-flight batches often — restart only
-- takes effect "between batches" per pg_net's own behavior, so any request
-- mid-flight when the restart is requested still completes normally.
-- ===========================================================================

create or replace function public.fn_cron_pgnet_worker_restart()
returns void language plpgsql as $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_net') then
    perform net.worker_restart();
  end if;
end;
$$;

comment on function public.fn_cron_pgnet_worker_restart() is
  'OPS-2 (docs/BUILD_NOTES.md) — scheduled every 10 minutes (job-pgnet-worker-restart). Forces pg_net''s single background worker to restart, discarding its shared libcurl/c-ares handle, which per curl/curl#18216 does not self-recover from a stuck DNS-resolution state after a timeout. Guarded by an extension-presence check the same way every other DB-internal cron function in this file''s sibling migrations is, so this stays a no-op off Supabase-hosted Postgres.';

do $$
declare
  v_pg_cron_ok boolean;
begin
  v_pg_cron_ok := exists (select 1 from pg_extension where extname = 'pg_cron');
  if not v_pg_cron_ok then
    raise notice 'pg_cron extension not installed — skipping job-pgnet-worker-restart schedule (expected outside a Supabase-hosted Postgres)';
    return;
  end if;

  -- DB-internal only (no pg_net HTTP call, no Vault secret needed) — safe to
  -- schedule unconditionally once pg_cron exists, same class as this repo's
  -- other job-internal-* jobs in 20260910093000_queues_and_scheduled_jobs.sql.
  perform public.fn_cron_upsert('job-pgnet-worker-restart', '*/10 * * * *',
    $sql$select public.fn_cron_pgnet_worker_restart();$sql$);
end;
$$;
