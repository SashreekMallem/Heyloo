-- QA-2 backend, round 2 (COCKPIT-F02, BE-03). Additive and idempotent.
--
-- NOTE ON ORDERING: this timestamp sorts before migrations that are already
-- applied on the live project (20260930230000, 20260930240000), like
-- 20260930200200 / 20260930200600 before it, so a CLI push needs
-- `supabase db push --include-all` (or apply by hand).

-- ---------------------------------------------------------------------
-- COCKPIT-F02: admin_actions.target_type CHECK did not list "lead" (outreach
-- reply actions) or "suppression_list" (outreach suppression add), both of
-- which supabase/functions/admin/handler.ts writes. The audit insert failed
-- with 23514 AFTER the mutation had run, so the request 500'd. Widen the
-- constraint (a superset: every existing row still satisfies it).
-- ---------------------------------------------------------------------
do $$
declare
  v_con record;
begin
  for v_con in
    select conname
    from pg_constraint
    where conrelid = 'public.admin_actions'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%target_type%'
  loop
    execute format('alter table public.admin_actions drop constraint %I', v_con.conname);
  end loop;

  alter table public.admin_actions
    add constraint admin_actions_target_type_check
    check (target_type in (
      'tenant', 'call', 'booking', 'order', 'referral', 'agent_template',
      'support_request', 'payout', 'campaign', 'flag', 'lead',
      'suppression_list', 'other'
    ));
end;
$$;

-- ---------------------------------------------------------------------
-- BE-03: Realtime only creates the realtime.messages daily partitions when a
-- client joins a channel (and in a janitor pass that covers only projects that
-- were connected since its previous run). The migration role cannot create
-- them itself (QA-1 review: it owns neither the table nor the schema), so
-- schedule the job-realtime-keepalive edge function, which joins a throw-away
-- channel every 30 minutes. Same Vault/pg_net pattern as job-keep-warm;
-- skipped with a NOTICE wherever pg_cron / pg_net / Vault or the Vault
-- secrets are missing (bare Postgres, `supabase start` before the deploy step).
-- ---------------------------------------------------------------------
do $$
declare
  v_base_url text;
  v_secret text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron extension not installed — skipping job-realtime-keepalive schedule (expected outside a Supabase-hosted Postgres)';
    return;
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise notice 'pg_net extension not installed — skipping job-realtime-keepalive schedule';
    return;
  end if;
  if not exists (select 1 from pg_extension where extname = 'supabase_vault') then
    raise notice 'supabase_vault extension not installed — skipping job-realtime-keepalive schedule';
    return;
  end if;

  select decrypted_secret into v_base_url from vault.decrypted_secrets where name = 'cron_functions_base_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_invoke_secret';
  if v_base_url is null or v_secret is null then
    raise notice 'cron_functions_base_url/cron_invoke_secret not yet present in Vault — skipping job-realtime-keepalive schedule (re-run after docs/DEPLOY.md §3.6''s vault.create_secret step; the call is idempotent by job name)';
    return;
  end if;

  perform public.fn_cron_upsert('job-realtime-keepalive', '*/30 * * * *', format(
    $fmt$select net.http_post(url := %L, headers := jsonb_build_object('x-cron-secret', %L), timeout_milliseconds := 15000);$fmt$,
    v_base_url || '/job-realtime-keepalive', v_secret));
end;
$$;
