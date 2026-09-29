-- SEC-2 regression test: same-tenant privilege escalation through PostgREST.
--
-- Runs as the database owner against a migrated database (CI: `supabase
-- start`, then `psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/
-- owner_column_grants.sql`), impersonates the `authenticated` role with an
-- owner / partner / member JWT-claims setting (exactly what PostgREST does),
-- and asserts, per table:
--   * EVERY column outside the allow-list below is rejected with 42501
--     (insufficient_privilege). Columns are enumerated from the catalog at
--     run time, so a column added later that someone grants by mistake (or
--     that the migration grants without updating the allow-list here) fails
--     the test instead of silently widening what an owner can write.
--   * every allow-listed column is updatable and the row is actually changed
--     (proves the RLS policy AND the column grant both let the portal write
--     through).
--   * INSERT and DELETE are rejected where the portal has no such write.
-- Everything runs in one transaction that is rolled back.
--
-- Keep the allow-lists in sync with supabase/migrations/
-- 20260929160000_lock_owner_writes_to_editable_columns.sql.

begin;

insert into auth.users (id, email) values
  ('5ec20000-0000-4000-8000-000000000001', 'sec2-owner@heyloo-ci.local'),
  ('5ec20000-0000-4000-8000-000000000002', 'sec2-partner@heyloo-ci.local');

insert into public.tenants (id, name, slug, vertical, avg_transaction_value_cents)
  values ('5ec20000-0000-4000-8000-0000000000a1', 'SEC-2 tenant', 'sec2-tenant', 'generic', 10000);

insert into public.memberships (id, tenant_id, user_id, role)
  values ('5ec20000-0000-4000-8000-0000000000b1',
          '5ec20000-0000-4000-8000-0000000000a1',
          '5ec20000-0000-4000-8000-000000000001', 'owner');

insert into public.agent_templates (id, vertical, name, version, compile_target, voice_id, model, disclosure_line)
  values ('5ec20000-0000-4000-8000-0000000000c1', 'generic', 'sec2', 900001, 'single_prompt', 'v', 'm', 'AI + recorded');

insert into public.agent_configs (id, tenant_id, template_id, template_version)
  values ('5ec20000-0000-4000-8000-0000000000d1',
          '5ec20000-0000-4000-8000-0000000000a1',
          '5ec20000-0000-4000-8000-0000000000c1', 900001);

insert into public.referral_partners (id, user_id, name, email)
  values ('5ec20000-0000-4000-8000-0000000000e1',
          '5ec20000-0000-4000-8000-000000000002', 'SEC-2 partner', 'sec2-partner@heyloo-ci.local');

insert into public.text_conversations (id, tenant_id, channel)
  values ('5ec20000-0000-4000-8000-0000000000f1',
          '5ec20000-0000-4000-8000-0000000000a1', 'sms');

insert into public.support_requests (id, tenant_id, subject, body)
  values ('5ec20000-0000-4000-8000-0000000000f2',
          '5ec20000-0000-4000-8000-0000000000a1', 's', 'b');

-- ---------------------------------------------------------------------
-- Generic checker. Lives in pg_temp only (never in the schema). Runs the
-- probes as `authenticated`, then restores the caller's role.
-- ---------------------------------------------------------------------
create function pg_temp.sec2_check(
  p_table text,
  p_pk_column text,
  p_pk uuid,
  p_claims jsonb,
  p_allowed jsonb -- { "column": <json value to write>, ... }
) returns void language plpgsql as $$
declare
  v_col text;
  v_all text[];
  v_val jsonb;
  v_rows bigint;
begin
  select array_agg(column_name::text order by ordinal_position) into v_all
  from information_schema.columns
  where table_schema = 'public' and table_name = p_table;

  perform set_config('request.jwt.claims', p_claims::text, true);
  set local role authenticated;

  foreach v_col in array v_all loop
    if p_allowed ? v_col then
      -- Allow-listed: the write must succeed and change exactly one row.
      v_val := p_allowed -> v_col;
      execute format(
        'update public.%I set %I = (jsonb_populate_record(null::public.%I, jsonb_build_object(%L, $1::jsonb))).%I where %I = $2',
        p_table, v_col, p_table, v_col, v_col, p_pk_column)
        using v_val, p_pk;
      get diagnostics v_rows = row_count;
      if v_rows <> 1 then
        raise exception 'SEC-2 FAIL: %.% is owner-editable but the update changed % rows (RLS or grant blocked the portal write)',
          p_table, v_col, v_rows using errcode = 'P0001';
      end if;
    else
      -- Everything else: rejected by column privileges before RLS is consulted.
      begin
        execute format('update public.%I set %I = %I where %I = $1',
          p_table, v_col, v_col, p_pk_column) using p_pk;
        raise exception 'SEC-2 FAIL: authenticated could UPDATE %.% (not on the owner-editable allow-list)',
          p_table, v_col using errcode = 'P0001';
      exception when insufficient_privilege then
        null; -- expected
      end;
    end if;
  end loop;

  reset role;
end;
$$;

-- Same idea for INSERT / DELETE, which the portal never performs on these.
create function pg_temp.sec2_expect_denied(p_sql text, p_claims jsonb, p_label text)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', p_claims::text, true);
  set local role authenticated;
  begin
    execute p_sql;
    raise exception 'SEC-2 FAIL: authenticated was allowed to %', p_label using errcode = 'P0001';
  exception when insufficient_privilege then
    null; -- expected
  end;
  reset role;
end;
$$;

-- ---------------------------------------------------------------------
-- tenants (owner)
-- ---------------------------------------------------------------------
select pg_temp.sec2_check(
  'tenants', 'id', '5ec20000-0000-4000-8000-0000000000a1',
  '{"sub":"5ec20000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"tenant_id":"5ec20000-0000-4000-8000-0000000000a1","role":"owner"}}',
  '{
    "name": "Renamed by owner",
    "timezone": "America/Chicago",
    "business_hours": {},
    "hours_exceptions": [],
    "language_config": {"primary": "en", "bilingual": false},
    "owner_test_phone": "+15555550100",
    "manual_mode": false,
    "manual_mode_enabled_at": null,
    "voice_reminders_enabled": true,
    "review_request_enabled": false,
    "review_url": "https://example.com/review",
    "avg_transaction_value_cents": 12345,
    "policies_reviewed_at": "2026-09-29T00:00:00Z",
    "text_agent_enabled": false,
    "text_agent_persona": {"tone": "friendly"},
    "quiet_hours": {"enabled": false},
    "widget_enabled": false,
    "widget_settings": {},
    "widget_public_key": "pk_sec2",
    "booking_min_notice_minutes": 30,
    "booking_horizon_days": 21
  }'::jsonb);

select pg_temp.sec2_expect_denied(
  $q$insert into public.tenants (name, slug, vertical) values ('x', 'sec2-x', 'generic')$q$,
  '{"sub":"5ec20000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"tenant_id":"5ec20000-0000-4000-8000-0000000000a1","role":"owner"}}',
  'INSERT into tenants');
select pg_temp.sec2_expect_denied(
  $q$delete from public.tenants where id = '5ec20000-0000-4000-8000-0000000000a1'$q$,
  '{"sub":"5ec20000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"tenant_id":"5ec20000-0000-4000-8000-0000000000a1","role":"owner"}}',
  'DELETE from tenants');

-- ---------------------------------------------------------------------
-- agent_configs (owner)
-- ---------------------------------------------------------------------
select pg_temp.sec2_check(
  'agent_configs', 'id', '5ec20000-0000-4000-8000-0000000000d1',
  '{"sub":"5ec20000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"tenant_id":"5ec20000-0000-4000-8000-0000000000a1","role":"owner"}}',
  '{
    "assistant_name": "Sam",
    "special_instructions": "Be brief.",
    "transfer_number": "+15555550101",
    "dynamic_variable_overrides": {"faq_items": []}
  }'::jsonb);

select pg_temp.sec2_expect_denied(
  $q$insert into public.agent_configs (tenant_id, template_id, template_version) values ('5ec20000-0000-4000-8000-0000000000a1', '5ec20000-0000-4000-8000-0000000000c1', 1)$q$,
  '{"sub":"5ec20000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"tenant_id":"5ec20000-0000-4000-8000-0000000000a1","role":"owner"}}',
  'INSERT into agent_configs');
select pg_temp.sec2_expect_denied(
  $q$delete from public.agent_configs where tenant_id = '5ec20000-0000-4000-8000-0000000000a1'$q$,
  '{"sub":"5ec20000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"tenant_id":"5ec20000-0000-4000-8000-0000000000a1","role":"owner"}}',
  'DELETE from agent_configs');

-- ---------------------------------------------------------------------
-- referral_partners (the partner themself)
-- ---------------------------------------------------------------------
select pg_temp.sec2_check(
  'referral_partners', 'id', '5ec20000-0000-4000-8000-0000000000e1',
  '{"sub":"5ec20000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"referral_partner_id":"5ec20000-0000-4000-8000-0000000000e1"}}',
  '{
    "paypal_email": "partner@example.com",
    "payout_method": "paypal",
    "ftc_acknowledged_at": "2026-09-29T00:00:00Z",
    "ftc_acknowledged_version": "v1"
  }'::jsonb);

select pg_temp.sec2_expect_denied(
  $q$insert into public.referral_partners (user_id, name, email) values ('5ec20000-0000-4000-8000-000000000002', 'x', 'x@example.com')$q$,
  '{"sub":"5ec20000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"referral_partner_id":"5ec20000-0000-4000-8000-0000000000e1"}}',
  'INSERT into referral_partners');

-- ---------------------------------------------------------------------
-- memberships (owner) — only the notifications watermark is writable
-- ---------------------------------------------------------------------
select pg_temp.sec2_check(
  'memberships', 'id', '5ec20000-0000-4000-8000-0000000000b1',
  '{"sub":"5ec20000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"tenant_id":"5ec20000-0000-4000-8000-0000000000a1","role":"owner"}}',
  '{"last_seen_notifications_at": "2026-09-29T00:00:00Z"}'::jsonb);

select pg_temp.sec2_expect_denied(
  $q$insert into public.memberships (tenant_id, user_id, role) values ('5ec20000-0000-4000-8000-0000000000a1', '5ec20000-0000-4000-8000-000000000002', 'owner')$q$,
  '{"sub":"5ec20000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"tenant_id":"5ec20000-0000-4000-8000-0000000000a1","role":"owner"}}',
  'INSERT into memberships');
select pg_temp.sec2_expect_denied(
  $q$delete from public.memberships where tenant_id = '5ec20000-0000-4000-8000-0000000000a1'$q$,
  '{"sub":"5ec20000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"tenant_id":"5ec20000-0000-4000-8000-0000000000a1","role":"owner"}}',
  'DELETE from memberships');

-- ---------------------------------------------------------------------
-- text_conversations (any member) — only `status`
-- ---------------------------------------------------------------------
select pg_temp.sec2_check(
  'text_conversations', 'id', '5ec20000-0000-4000-8000-0000000000f1',
  '{"sub":"5ec20000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"tenant_id":"5ec20000-0000-4000-8000-0000000000a1","role":"member"}}',
  '{"status": "human"}'::jsonb);

-- ---------------------------------------------------------------------
-- support_requests — tenants may raise tickets (INSERT), never edit/delete
-- ---------------------------------------------------------------------
select pg_temp.sec2_check(
  'support_requests', 'id', '5ec20000-0000-4000-8000-0000000000f2',
  '{"sub":"5ec20000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"tenant_id":"5ec20000-0000-4000-8000-0000000000a1","role":"owner"}}',
  '{}'::jsonb);

select pg_temp.sec2_expect_denied(
  $q$delete from public.support_requests where tenant_id = '5ec20000-0000-4000-8000-0000000000a1'$q$,
  '{"sub":"5ec20000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"tenant_id":"5ec20000-0000-4000-8000-0000000000a1","role":"owner"}}',
  'DELETE from support_requests');

-- The portal's ticket-creation write must keep working.
do $$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"5ec20000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"tenant_id":"5ec20000-0000-4000-8000-0000000000a1","role":"owner"}}', true);
  set local role authenticated;
  insert into public.support_requests (tenant_id, subject, body)
    values ('5ec20000-0000-4000-8000-0000000000a1', 'portal ticket', 'still works');
  reset role;
end $$;

rollback;
