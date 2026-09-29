-- INTAKE-Q-1 regression test: agent_configs_custom_questions_valid CHECK /
-- public.custom_questions_valid() (migration 20260930230000).
--
-- Runs as the database owner against a migrated database (CI: `supabase
-- start`, then `psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f
-- supabase/tests/agent_custom_questions.sql`). Everything runs in one
-- transaction that is rolled back. A failed assertion raises, which fails the
-- psql run.
--
-- Covers: rows without the key stay valid; a well-formed list is accepted;
-- more than 10 questions, a label over 200 characters, a blank label, an
-- unknown applies_to, a bad or duplicate id, a missing required flag, a
-- non-array value and a non-object element are all refused by the database
-- itself (not only by the portal route).

begin;

do $$
declare
  ok jsonb := '[{"id":"q_1","label":"How did you hear about us?","required":true,"applies_to":"both","position":0,"active":true},
                {"id":"q_2","label":"Gate code?","hint":"four digits","required":false,"applies_to":"booking","position":1,"active":false}]';
begin
  -- function-level truth table
  assert public.custom_questions_valid(null), 'null is valid (key absent)';
  assert public.custom_questions_valid('[]'::jsonb), 'empty list is valid';
  assert public.custom_questions_valid(ok), 'a well-formed list is valid';
  assert not public.custom_questions_valid('{"a":1}'::jsonb), 'non-array refused';
  assert not public.custom_questions_valid('[1]'::jsonb), 'non-object element refused';
  assert not public.custom_questions_valid(
    '[{"id":"q_1","label":"a","required":true,"applies_to":"all","position":0,"active":true}]'::jsonb
  ), 'unknown applies_to refused';
  assert not public.custom_questions_valid(
    '[{"id":"Bad Id","label":"a","required":true,"applies_to":"both","position":0,"active":true}]'::jsonb
  ), 'bad id refused';
  assert not public.custom_questions_valid(
    '[{"id":"q_1","label":"   ","required":true,"applies_to":"both","position":0,"active":true}]'::jsonb
  ), 'blank label refused';
  assert not public.custom_questions_valid(
    ('[{"id":"q_1","label":"' || repeat('a', 201) || '","required":true,"applies_to":"both","position":0,"active":true}]')::jsonb
  ), 'label over 200 characters refused';
  assert public.custom_questions_valid(
    ('[{"id":"q_1","label":"' || repeat('a', 200) || '","required":true,"applies_to":"both","position":0,"active":true}]')::jsonb
  ), 'label of exactly 200 characters accepted';
  assert not public.custom_questions_valid(
    '[{"id":"q_1","label":"a","applies_to":"both","position":0,"active":true}]'::jsonb
  ), 'missing required flag refused';
  assert not public.custom_questions_valid(
    '[{"id":"q_1","label":"a","required":true,"applies_to":"both","position":0,"active":true},
      {"id":"q_1","label":"b","required":true,"applies_to":"both","position":1,"active":true}]'::jsonb
  ), 'duplicate id refused';
  assert public.custom_questions_valid(
    (select jsonb_agg(jsonb_build_object('id', 'q' || i, 'label', 'a', 'required', false,
                                          'applies_to', 'both', 'position', i, 'active', true))
       from generate_series(1, 10) i)
  ), 'exactly 10 questions accepted';
  assert not public.custom_questions_valid(
    (select jsonb_agg(jsonb_build_object('id', 'q' || i, 'label', 'a', 'required', false,
                                          'applies_to', 'both', 'position', i, 'active', true))
       from generate_series(1, 11) i)
  ), '11 questions refused';
end $$;

insert into public.tenants (id, name, slug, vertical, timezone)
values ('c1c10000-0000-4000-8000-0000000000a1', 'cq tenant', 'cq-tenant', 'generic', 'UTC');

insert into public.agent_templates (id, vertical, name, version, compile_target, voice_id, model, disclosure_line)
values ('c1c10000-0000-4000-8000-0000000000b1', 'generic', 'cq template', 987654, 'single_prompt',
        'v', 'm', 'This call may be recorded and you are speaking with an AI assistant.');

-- No custom_questions key: the constraint is satisfied (every pre-existing row).
insert into public.agent_configs (id, tenant_id, template_id, template_version, dynamic_variable_overrides)
values ('c1c10000-0000-4000-8000-0000000000c1', 'c1c10000-0000-4000-8000-0000000000a1',
        'c1c10000-0000-4000-8000-0000000000b1', 987654, '{"manager_name":"Sam"}'::jsonb);

-- A valid list is accepted through the real column.
update public.agent_configs
   set dynamic_variable_overrides = dynamic_variable_overrides || jsonb_build_object(
     'custom_questions',
     '[{"id":"q_1","label":"How did you hear about us?","required":true,"applies_to":"both","position":0,"active":true}]'::jsonb)
 where id = 'c1c10000-0000-4000-8000-0000000000c1';

-- An invalid write is refused by the CHECK (check_violation), leaving the row untouched.
do $$
declare
  refused boolean := false;
begin
  begin
    update public.agent_configs
       set dynamic_variable_overrides = dynamic_variable_overrides || jsonb_build_object(
         'custom_questions',
         (select jsonb_agg(jsonb_build_object('id', 'q' || i, 'label', 'a', 'required', false,
                                               'applies_to', 'both', 'position', i, 'active', true))
            from generate_series(1, 11) i))
     where id = 'c1c10000-0000-4000-8000-0000000000c1';
  exception when check_violation then
    refused := true;
  end;
  assert refused, 'the CHECK must refuse an 11th custom question';
  assert (select jsonb_array_length(dynamic_variable_overrides -> 'custom_questions')
            from public.agent_configs where id = 'c1c10000-0000-4000-8000-0000000000c1') = 1,
    'the refused write left the saved list untouched';
end $$;

rollback;
