-- Cron entry for job-lead-callback-retry (docs/audit/FIX_REQUESTS.md —
-- "a future job-lead-callback-retry ... to drain lead_callback_requests
-- rows stuck in deferred_quiet_hours"). Additive follow-up to
-- 20260910093000_queues_and_scheduled_jobs.sql — never edit that (or any
-- other already-applied migration) after being applied (CLAUDE.md Rule 2)
-- — reuses its exact fn_cron_upsert(...)/Vault-secret pattern and guard
-- structure verbatim (same shape as 20260910140100_commission_accrual_cron_schedule.sql
-- and 20260910122000_motel_deposit_hold_expiry_cron.sql). Already deployed
-- with verify_jwt = false + CRON_INVOKE_SECRET wired (supabase/config.toml);
-- only the cron.schedule mapping is added here.
--
-- Every 15 minutes, matching job-motel-deposit-hold-expiry's own cadence
-- for a similarly time-sensitive "past a computed deadline" sweep — a
-- deferred lead is retried within 15 minutes of its tenant's quiet-hours
-- window actually ending, not hours later.

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
    raise notice 'pg_cron extension not installed — skipping cron.schedule call (expected outside a Supabase-hosted Postgres)';
    return;
  end if;

  v_pg_net_ok := exists (select 1 from pg_extension where extname = 'pg_net');
  v_vault_ok := exists (select 1 from pg_extension where extname = 'supabase_vault');

  if not v_pg_net_ok then
    raise notice 'pg_net extension not installed — skipping job-lead-callback-retry cron job (expected outside a Supabase-hosted Postgres)';
    return;
  end if;
  if not v_vault_ok then
    raise notice 'supabase_vault extension not installed — skipping job-lead-callback-retry cron job until the deploy step inserts cron_functions_base_url/cron_invoke_secret (docs/DEPLOY.md §3.6)';
    return;
  end if;

  select decrypted_secret into v_base_url from vault.decrypted_secrets where name = 'cron_functions_base_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_invoke_secret';

  if v_base_url is null or v_secret is null then
    raise notice 'cron_functions_base_url/cron_invoke_secret not yet present in Vault — skipping job-lead-callback-retry cron job until docs/DEPLOY.md §3.6''s vault.create_secret step runs (re-run this migration''s statements afterward, or push again — idempotent by job name)';
    return;
  end if;

  perform public.fn_cron_upsert('job-lead-callback-retry', '*/15 * * * *', format(
    $fmt$select net.http_post(url := %L, headers := jsonb_build_object('x-cron-secret', %L), timeout_milliseconds := 60000);$fmt$,
    v_base_url || '/job-lead-callback-retry', v_secret));
end;
$$;
