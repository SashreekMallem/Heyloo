-- Cron entry for job-commission-accrual (GAP_REGISTER Cluster G item 1).
-- Additive follow-up to 20260910093000_queues_and_scheduled_jobs.sql /
-- 20260910100500_new_job_cron_schedules.sql — never edit either after
-- being applied (CLAUDE.md Rule 2) — reuses their exact
-- fn_cron_upsert(...)/Vault-secret pattern and guard structure. Already
-- deployed with verify_jwt = false + CRON_INVOKE_SECRET wired
-- (supabase/config.toml); only the cron.schedule mapping is added here.
--
-- Runs at 06:00 UTC on the 1st, TWO HOURS before job-referral-payouts'
-- `0 8 1 * *` same-day batch run — so that month's recurring commission
-- accrual is in `commission_events` (status 'accrued') before the payout
-- batch queries for accrued rows to pay out.

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
    raise notice 'pg_net extension not installed — skipping job-commission-accrual cron job (expected outside a Supabase-hosted Postgres)';
    return;
  end if;
  if not v_vault_ok then
    raise notice 'supabase_vault extension not installed — skipping job-commission-accrual cron job until the deploy step inserts cron_functions_base_url/cron_invoke_secret (docs/DEPLOY.md §3.6)';
    return;
  end if;

  select decrypted_secret into v_base_url from vault.decrypted_secrets where name = 'cron_functions_base_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_invoke_secret';

  if v_base_url is null or v_secret is null then
    raise notice 'cron_functions_base_url/cron_invoke_secret not yet present in Vault — skipping job-commission-accrual cron job until docs/DEPLOY.md §3.6''s vault.create_secret step runs (re-run this migration''s statements afterward, or push again — idempotent by job name)';
    return;
  end if;

  perform public.fn_cron_upsert('job-commission-accrual', '0 6 1 * *', format(
    $fmt$select net.http_post(url := %L, headers := jsonb_build_object('x-cron-secret', %L), timeout_milliseconds := 60000);$fmt$,
    v_base_url || '/job-commission-accrual', v_secret));
end;
$$;
