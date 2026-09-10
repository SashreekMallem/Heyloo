-- Cron entries for four new HTTP-calling jobs (BACKEND_SPEC §8 cadences),
-- appended per docs/audit/FIX_REQUESTS.md (cluster F, for cluster A).
-- Additive follow-up to 20260910093000_queues_and_scheduled_jobs.sql —
-- never edit that file after it's applied (CLAUDE.md Rule 2) — reusing its
-- own fn_cron_upsert(...)/Vault-secret pattern and guard structure exactly.
-- All four functions are already deployed with
-- verify_jwt = false + CRON_INVOKE_SECRET wired in supabase/config.toml;
-- only the cron.schedule mapping was missing.
--
--   Job (BACKEND_SPEC §8 name)                     | Function slug            | Schedule
--   Churn scoring                                  | job-churn-scoring        | 0 6 * * *
--   Weekly value emails                            | job-value-email          | 0 14 * * 1
--   Offboarding (number port-out + archive)        | job-offboarding          | 45 5 * * *
--   Retention sweep (Storage recordings)            | job-retention-sweep      | 0 5 * * *

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
    raise notice 'pg_cron extension not installed — skipping all cron.schedule calls (expected outside a Supabase-hosted Postgres)';
    return;
  end if;

  v_pg_net_ok := exists (select 1 from pg_extension where extname = 'pg_net');
  v_vault_ok := exists (select 1 from pg_extension where extname = 'supabase_vault');

  if not v_pg_net_ok then
    raise notice 'pg_net extension not installed — skipping every HTTP-calling cron job (expected outside a Supabase-hosted Postgres)';
    return;
  end if;
  if not v_vault_ok then
    raise notice 'supabase_vault extension not installed — skipping every HTTP-calling cron job until the deploy step inserts cron_functions_base_url/cron_invoke_secret (docs/DEPLOY.md §3.6)';
    return;
  end if;

  select decrypted_secret into v_base_url from vault.decrypted_secrets where name = 'cron_functions_base_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_invoke_secret';

  if v_base_url is null or v_secret is null then
    raise notice 'cron_functions_base_url/cron_invoke_secret not yet present in Vault — skipping every HTTP-calling cron job until docs/DEPLOY.md §3.6''s vault.create_secret step runs (re-run this migration''s statements afterward, or push again — every call here is idempotent by job name)';
    return;
  end if;

  perform public.fn_cron_upsert('job-churn-scoring', '0 6 * * *', format(
    $fmt$select net.http_post(url := %L, headers := jsonb_build_object('x-cron-secret', %L), timeout_milliseconds := 30000);$fmt$,
    v_base_url || '/job-churn-scoring', v_secret));
  perform public.fn_cron_upsert('job-value-email', '0 14 * * 1', format(
    $fmt$select net.http_post(url := %L, headers := jsonb_build_object('x-cron-secret', %L), timeout_milliseconds := 30000);$fmt$,
    v_base_url || '/job-value-email', v_secret));
  perform public.fn_cron_upsert('job-offboarding', '45 5 * * *', format(
    $fmt$select net.http_post(url := %L, headers := jsonb_build_object('x-cron-secret', %L), timeout_milliseconds := 60000);$fmt$,
    v_base_url || '/job-offboarding', v_secret));
  perform public.fn_cron_upsert('job-retention-sweep', '0 5 * * *', format(
    $fmt$select net.http_post(url := %L, headers := jsonb_build_object('x-cron-secret', %L), timeout_milliseconds := 60000);$fmt$,
    v_base_url || '/job-retention-sweep', v_secret));
end;
$$;
