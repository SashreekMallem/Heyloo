-- SPEED-1: automatic agent republish (docs/BUILD_NOTES.md).
--
-- A published Retell agent only changes when it is rebuilt. Until now that
-- happened only when an owner pressed "Publish changes", so platform
-- improvements never reached most tenants' calls. job-agent-auto-republish
-- rebuilds every active tenant whose agent is behind (older compiler
-- version, or published before the owner's last call-language change),
-- keeping the previous Retell agent for rollback.
--
-- auto_republish_attempted_at is the job's claim: a tenant is skipped for 6
-- hours after an attempt, so overlapping runs never rebuild the same tenant
-- and a failure is retried rather than hammered. auto_republish_error keeps
-- the last failure reason for support. Both are written only by the job
-- (secret key); owners never write them.

alter table public.agent_configs
  add column if not exists auto_republish_attempted_at timestamptz,
  add column if not exists auto_republish_error text;

comment on column public.agent_configs.auto_republish_attempted_at is
  'When job-agent-auto-republish last claimed this tenant (6-hour retry window).';
comment on column public.agent_configs.auto_republish_error is
  'Last job-agent-auto-republish failure reason; null after a successful claim.';

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
    raise notice 'pg_net extension not installed — skipping job-agent-auto-republish cron job (expected outside a Supabase-hosted Postgres)';
    return;
  end if;
  if not v_vault_ok then
    raise notice 'supabase_vault extension not installed — skipping job-agent-auto-republish cron job until the deploy step inserts cron_functions_base_url/cron_invoke_secret (docs/DEPLOY.md §3.6)';
    return;
  end if;

  select decrypted_secret into v_base_url from vault.decrypted_secrets where name = 'cron_functions_base_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_invoke_secret';

  if v_base_url is null or v_secret is null then
    raise notice 'cron_functions_base_url/cron_invoke_secret not yet present in Vault — skipping job-agent-auto-republish cron job until docs/DEPLOY.md §3.6''s vault.create_secret step runs (re-run this migration''s statements afterward, or push again — idempotent by job name)';
    return;
  end if;

  perform public.fn_cron_upsert('job-agent-auto-republish', '*/5 * * * *', format(
    $fmt$select net.http_post(url := %L, headers := jsonb_build_object('x-cron-secret', %L), timeout_milliseconds := 120000);$fmt$,
    v_base_url || '/job-agent-auto-republish', v_secret));
end;
$$;
