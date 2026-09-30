-- QA-2 backend regression test (migration
-- 20260930210600_qa2_backend_realtime_and_audit_types.sql: COCKPIT-F02, BE-03).
--
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/qa2_backend.sql
-- One transaction, rolled back. Each check raises on failure.

begin;

-- COCKPIT-F02: admin_actions.target_type accepts every type the admin edge
-- function writes ("lead", "suppression_list" were missing and the audit
-- insert failed with 23514 after the mutation had run) and still rejects junk.
do $$
declare
  v_admin uuid := gen_random_uuid();
  v_type text;
begin
  insert into auth.users (id, email)
  values (v_admin, 'qa2-audit-' || v_admin || '@example.test');

  foreach v_type in array array['tenant', 'call', 'booking', 'order', 'referral', 'agent_template',
    'support_request', 'payout', 'campaign', 'flag', 'lead', 'suppression_list', 'other'] loop
    insert into public.admin_actions (admin_user_id, action, target_type)
    values (v_admin, 'qa2_probe', v_type);
  end loop;

  begin
    insert into public.admin_actions (admin_user_id, action, target_type)
    values (v_admin, 'qa2_probe', 'not_a_type');
    raise exception 'COCKPIT-F02: admin_actions accepted an unknown target_type';
  exception when check_violation then
    null;
  end;
end;
$$;

-- BE-03: where pg_cron and the Vault secrets exist, the keep-alive job is
-- scheduled every 30 minutes at the job-realtime-keepalive function.
do $$
declare
  v_schedule text;
  v_command text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron')
     or not exists (select 1 from pg_extension where extname = 'supabase_vault')
     or not exists (select 1 from vault.decrypted_secrets where name = 'cron_functions_base_url')
     or not exists (select 1 from vault.decrypted_secrets where name = 'cron_invoke_secret') then
    raise notice 'BE-03: pg_cron / Vault secrets absent, skipping the keep-alive schedule check';
    return;
  end if;
  select schedule, command into v_schedule, v_command
    from cron.job where jobname = 'job-realtime-keepalive';
  if v_schedule is null then
    raise exception 'BE-03: job-realtime-keepalive is not scheduled';
  end if;
  if v_schedule <> '*/30 * * * *' or v_command not like '%/job-realtime-keepalive%' then
    raise exception 'BE-03: job-realtime-keepalive has the wrong schedule/target (% / %)', v_schedule, v_command;
  end if;
end;
$$;

rollback;
