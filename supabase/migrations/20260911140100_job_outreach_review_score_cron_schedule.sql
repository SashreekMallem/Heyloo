-- Cron entry for the new OUTREACH-2 job — phone-complaint review scoring
-- (docs/spec/API_AND_FLOWS.md Flow 5 step 2, docs/research/
-- CUSTOMER_ACQUISITION_TOOLS_2026.md recommendation #2). Additive
-- follow-up to 20260910093000_queues_and_scheduled_jobs.sql and its own
-- later per-job cron-schedule migrations (20260910100600, 20260910140100,
-- 20260910160000, 20260910122000) — never edit any of those files after
-- they're applied (CLAUDE.md Rule 2) — reusing their exact
-- `fn_cron_upsert(...)`/Vault-secret pattern and guard structure.
--
--   Job (this task's own name)        | Function slug              | Schedule
--   Outreach review-score (phone-complaint scoring) | job-outreach-review-score | 0 * * * * (hourly)
--
-- Hourly, not the personalize pipeline's 15-minute cadence: this job makes
-- a real-money Outscraper Reviews call per lead (cost-bounded by its own
-- per-run cap, `_shared` docstring in job-outreach-review-score/index.ts) —
-- an hourly cadence is plenty to keep the fetch batch scored well ahead of
-- the personalize job picking leads up, without re-running the cost-bound
-- check unnecessarily often.
--
-- job-outreach-review-score is deployed with verify_jwt = false +
-- CRON_INVOKE_SECRET wired in supabase/config.toml, matching every other
-- job-*/worker-* function; only the cron.schedule mapping was missing.

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

  perform public.fn_cron_upsert('job-outreach-review-score', '0 * * * *', format(
    $fmt$select net.http_post(url := %L, headers := jsonb_build_object('x-cron-secret', %L), timeout_milliseconds := 45000);$fmt$,
    v_base_url || '/job-outreach-review-score', v_secret));
end;
$$;
