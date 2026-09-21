-- NIGHTLY-1: cron schedule for `job-agent-regression`, split out from
-- 20260921120000_agent_regression_runs.sql (see that file's own comment) so
-- this vault-gated block — and only this block — is the part
-- `scripts/ci/cron-queues-check.ts`'s `CRON_MIGRATIONS` re-applies. Same
-- vault-gated fn_cron_upsert pattern as every other HTTP-calling job
-- (20260910100500_new_job_cron_schedules.sql etc.) — additive, idempotent
-- by job name, skips with a `raise notice` (never errors) when
-- pg_cron/pg_net/vault or the shared cron_functions_base_url/
-- cron_invoke_secret Vault secrets aren't present yet.
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
    raise notice 'pg_cron extension not installed — skipping job-agent-regression cron schedule (expected outside a Supabase-hosted Postgres)';
    return;
  end if;

  v_pg_net_ok := exists (select 1 from pg_extension where extname = 'pg_net');
  v_vault_ok := exists (select 1 from pg_extension where extname = 'supabase_vault');

  if not v_pg_net_ok then
    raise notice 'pg_net extension not installed — skipping job-agent-regression cron schedule (expected outside a Supabase-hosted Postgres)';
    return;
  end if;
  if not v_vault_ok then
    raise notice 'supabase_vault extension not installed — skipping job-agent-regression cron schedule until the deploy step inserts cron_functions_base_url/cron_invoke_secret (docs/DEPLOY.md §3.6)';
    return;
  end if;

  select decrypted_secret into v_base_url from vault.decrypted_secrets where name = 'cron_functions_base_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_invoke_secret';

  if v_base_url is null or v_secret is null then
    raise notice 'cron_functions_base_url/cron_invoke_secret not yet present in Vault — skipping job-agent-regression cron schedule until docs/DEPLOY.md §3.6''s vault.create_secret step runs (re-run this migration''s statements afterward, or push again — idempotent by job name)';
    return;
  end if;

  -- Short timeout: this request only needs to clear job-agent-regression's
  -- own fast-ack (it responds immediately and continues the real
  -- multi-tenant batch-test run via `EdgeRuntime.waitUntil` in the
  -- background — see that function's own header comment) — never the full
  -- multi-minute regression sweep itself.
  perform public.fn_cron_upsert('job-agent-regression', '0 9 * * *', format(
    $fmt$select net.http_post(url := %L, headers := jsonb_build_object('x-cron-secret', %L), timeout_milliseconds := 20000);$fmt$,
    v_base_url || '/job-agent-regression', v_secret));
end;
$$;
