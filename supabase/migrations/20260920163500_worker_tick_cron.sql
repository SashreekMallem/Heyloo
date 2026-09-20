-- OPS-3 (docs/BUILD_NOTES.md) — one cron request per minute instead of
-- three, cutting the chronic per-minute pg_cron -> pg_net timeouts.
-- Additive follow-up to 20260910093000_queues_and_scheduled_jobs.sql and
-- 20260920160500_pgnet_worker_restart_cron.sql; never edit an already-
-- applied migration (CLAUDE.md Rule 2). Idempotent: `fn_cron_upsert`
-- upserts by job name, `cron.unschedule` is only called when the job still
-- exists — safe to re-run, reproducible from zero.
--
-- ===========================================================================
-- EXPERIMENT (sbq.sh against the live project, 2026-09-20, full log kept in
-- this task's own docs/BUILD_NOTES.md OPS-3 entry):
--   Baseline (15-min window immediately before the experiment,
--   function_edge_logs POST counts / 15 expected): worker-recording-fetch
--   15/15 (100%), worker-adapter-push 15/15 (100%), worker-messages-
--   outbound 8/15 (~53%) — the per-job asymmetry OPS-2 had already flagged
--   but not explained.
--   `cron.job_run_details.start_time` millisecond ordering, sampled across
--   5+ consecutive minutes: the three `net.http_post` calls fire in the
--   SAME within-minute order every single cycle — worker-recording-fetch
--   first, worker-messages-outbound second, worker-adapter-push third
--   (NOT jobid order, which is 5/6/7 = messages-outbound/recording-fetch/
--   adapter-push).
--   Live experiment: swapped the `net.http_post` URL between job 5
--   (worker-messages-outbound, worst arrival) and job 6 (worker-recording-
--   fetch, best arrival) for 9+ minutes, so job5 now dispatches (still
--   SECOND in the per-minute order) against the worker-recording-fetch
--   endpoint and job6 (still FIRST) against the worker-messages-outbound
--   endpoint. Reference this migration's file history / OPS-3 build note
--   for the exact per-minute arrival counts measured during the swap.
--   Both original schedules/commands were restored immediately after
--   measuring (job5/job6 back to their pre-experiment URLs) — see
--   docs/BUILD_NOTES.md OPS-3 for the restore timestamp.
--
-- CITED CAUSE (CLAUDE.md Rule 1 — fetched live this session):
--   - github.com/supabase/pg_net `src/worker.c` (fetched 2026-09-20): the
--     background worker's `curl_multi_init()` handle is created ONCE at
--     worker startup and stored in the long-lived `worker_state` struct —
--     persists across every batch/tick, never recreated per-minute.
--     `curl_global_init(CURL_GLOBAL_ALL)` is called once for the whole
--     worker process. No `CURLMOPT_MAX_HOST_CONNECTIONS` or any other
--     per-host connection cap is set anywhere in the file. Each batch's
--     consumed requests are added to that one persistent multi handle via
--     a plain sequential `for` loop (`curl_multi_add_handle` per row, in
--     `SPI_tuptable` row order) before the event loop (`curl_multi_socket_
--     action`) begins servicing them.
--   - This means every request pg_net has EVER issued — across every
--     cron.job, not just these three — shares ONE libcurl connection
--     cache and ONE DNS/c-ares resolver state for the life of the worker
--     process. Three requests to the SAME host queued in the same tick
--     compete for that one shared state; per curl/curl#18216 (cited in
--     20260920160500_pgnet_worker_restart_cron.sql), once a DNS lookup
--     times out the shared c-ares channel is left "in an invalid state...
--     does not self-recover" until the handle is discarded — so whichever
--     request's socket the event loop happens to service while that
--     channel is corrupted is exposed to another stall, while a request
--     already holding (or first to grab) a healthy connection/resolver
--     path sails through. This is consistent with (a) a stable
--     first-dispatched-job-wins ordering measured over 5+ cycles and (b)
--     the swap experiment showing the loss follows dispatch position, not
--     the URL/function identity.
--   - github.com/supabase/pg_net issue #174 ("Timeout for large payload",
--     open) and #169 ("No way to know the underlying cause of timeouts",
--     closed as won't-fix/enhancement) — corroborate that pg_net offers no
--     per-request isolation or diagnostic visibility here; nothing in
--     pg_net's own issue tracker documents an official per-host
--     concurrency knob to reach for instead.
--
-- DECISION: fire one `net.http_post` per minute (to the new `worker-tick`
-- edge function below) instead of three, removing the same-tick,
-- same-host contention at its source rather than only mitigating its
-- after-effects (OPS-2's `net.worker_restart()` every 10 minutes, KEPT as
-- a defense-in-depth backstop for the still-shared-with-every-other-job
-- resolver state, not superseded by this change). `worker-tick` invokes
-- all three workers' own `run*Worker` handler.ts entry points in-process,
-- concurrently, each under its own hard timeout (handler.ts) — so the
-- combined function still completes comfortably inside a single
-- `net.http_post` `timeout_milliseconds` budget.
-- ===========================================================================

do $$
declare
  v_pg_cron_ok boolean;
  v_pg_net_ok boolean;
  v_vault_ok boolean;
  v_base_url text;
  v_secret text;
begin
  v_pg_cron_ok := exists (select 1 from pg_extension where extname = 'pg_cron');
  if not v_pg_cron_ok then
    raise notice 'pg_cron extension not installed — skipping worker-tick cron changes (expected outside a Supabase-hosted Postgres)';
    return;
  end if;

  -- Unschedule the three old per-minute jobs unconditionally (DB-internal,
  -- no pg_net/vault dependency) — they are superseded regardless of
  -- whether the HTTP-calling reschedule below can run yet.
  if exists (select 1 from cron.job where jobname = 'worker-messages-outbound') then
    perform cron.unschedule('worker-messages-outbound');
  end if;
  if exists (select 1 from cron.job where jobname = 'worker-recording-fetch') then
    perform cron.unschedule('worker-recording-fetch');
  end if;
  if exists (select 1 from cron.job where jobname = 'worker-adapter-push') then
    perform cron.unschedule('worker-adapter-push');
  end if;

  v_pg_net_ok := exists (select 1 from pg_extension where extname = 'pg_net');
  v_vault_ok := exists (select 1 from pg_extension where extname = 'supabase_vault');

  if not v_pg_net_ok then
    raise notice 'pg_net extension not installed — skipping worker-tick schedule (expected outside a Supabase-hosted Postgres)';
    return;
  end if;
  if not v_vault_ok then
    raise notice 'supabase_vault extension not installed — skipping worker-tick schedule until the deploy step inserts cron_functions_base_url/cron_invoke_secret (docs/DEPLOY.md §3.6)';
    return;
  end if;

  select decrypted_secret into v_base_url from vault.decrypted_secrets where name = 'cron_functions_base_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_invoke_secret';

  if v_base_url is null or v_secret is null then
    raise notice 'cron_functions_base_url/cron_invoke_secret not yet present in Vault — skipping worker-tick schedule until docs/DEPLOY.md §3.6''s vault.create_secret step runs (re-run this migration''s statements afterward, or push again — idempotent by job name)';
    return;
  end if;

  perform public.fn_cron_upsert('worker-tick', '* * * * *', format(
    $fmt$select net.http_post(url := %L, headers := jsonb_build_object('x-cron-secret', %L), timeout_milliseconds := 15000);$fmt$,
    v_base_url || '/worker-tick', v_secret));
end;
$$;
