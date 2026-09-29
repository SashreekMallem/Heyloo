-- QA-1 cockpit regression test (migration 20260930200400_qa1_cockpit_fixes.sql).
--
-- Runs as the database owner against a migrated database (CI: `supabase
-- start`, then `psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f
-- supabase/tests/qa1_cockpit_fixes.sql`). Everything runs in one transaction
-- that is rolled back; a failed assertion raises and fails the psql run.
--
-- Covers: one OPEN alert per rule + tenant (+ tool) for the three
-- job-alert-evaluation rules (F07), an acked alert freeing the slot, other
-- rules staying unconstrained, the campaign send-cap bounds (F08), the
-- `created_by` default on support_requests (F25) and that the referral
-- qualification function reads the settings it is now documented to read (F06).

begin;

do $$
declare
  raised boolean;
begin
  -- F07: the first open alert per rule/tool is accepted, a second one is refused.
  insert into public.alerts (rule, severity, payload)
  values ('tool_failure_spike', 'critical', '{"tool_name":"book_appointment"}');
  insert into public.alerts (rule, severity, payload)
  values ('tool_failure_spike', 'critical', '{"tool_name":"lookup_customer"}');

  raised := false;
  begin
    insert into public.alerts (rule, severity, payload)
    values ('tool_failure_spike', 'critical', '{"tool_name":"book_appointment"}');
  exception when unique_violation then
    raised := true;
  end;
  assert raised, 'a second open tool_failure_spike alert for the same tool must be refused';

  -- Acking frees the slot: the condition may fire again.
  update public.alerts set status = 'acked'
  where rule = 'tool_failure_spike' and payload->>'tool_name' = 'book_appointment';
  insert into public.alerts (rule, severity, payload)
  values ('tool_failure_spike', 'critical', '{"tool_name":"book_appointment"}');

  -- Rules outside the index (each row is a distinct event) stay unconstrained.
  insert into public.alerts (rule, severity, payload) values ('payment_failed', 'warning', '{}');
  insert into public.alerts (rule, severity, payload) values ('payment_failed', 'warning', '{}');
end;
$$;

do $$
declare
  raised boolean := false;
begin
  -- F08: daily_send_cap is bounded 1..2000.
  begin
    insert into public.campaigns (name, sender_domain, provider, daily_send_cap)
    values ('cap too high', 'mail.example.com', 'smartlead', 5000);
  exception when check_violation then
    raised := true;
  end;
  assert raised, 'daily_send_cap above 2000 must be refused';

  insert into public.campaigns (name, sender_domain, provider, daily_send_cap)
  values ('cap ok', 'mail.example.com', 'smartlead', 100);
end;
$$;

do $$
begin
  -- F25: the creator is recorded by default.
  assert (
    select column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'support_requests' and column_name = 'created_by'
  ) like '%auth.uid()%', 'support_requests.created_by must default to auth.uid()';

  -- F06: the qualification function honors the rule's value and both amount keys.
  assert pg_get_functiondef('public.fn_check_referral_qualification()'::regprocedure)
    like '%referral_qualification_rule%', 'qualification threshold must come from platform_settings';
  assert pg_get_functiondef('public.fn_check_referral_qualification()'::regprocedure)
    like '%flat_amount_cents%', 'flat amount must be read from flat_amount_cents';
end;
$$;

rollback;
