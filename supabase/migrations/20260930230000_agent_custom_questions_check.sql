-- INTAKE-Q-1: owner-defined custom intake questions.
--
-- Storage decision: the list lives at
-- `agent_configs.dynamic_variable_overrides -> 'custom_questions'` (a jsonb
-- array), next to the FAQ (`faq_items`) and the other owner settings, rather
-- than in a new table or column:
--   * `voice-inbound` already reads `dynamic_variable_overrides` before every
--     call, so the per-call `{{custom_questions_text}}` variable costs no extra
--     query, and an edit is live on the next call with no republish;
--   * RLS (`agent_configs_update`, owner/admin) and the SEC-2 column grant
--     (`dynamic_variable_overrides` is already writable by `authenticated`)
--     already cover it, so no new policy or grant is needed;
--   * the list is small (max 10), always read and written whole, and ordered by
--     an explicit `position`, which a jsonb array models without a join.
-- What a bare jsonb column lacks is server-enforced shape, so this migration
-- adds it as a CHECK: a portal (or direct PostgREST) write can never store more
-- than 10 questions, a label over 200 characters, an unknown `applies_to`, etc.
--
-- Element shape (all keys required unless noted):
--   id          text  ^[a-z0-9_-]{1,32}$, unique within the array
--   label       text  1..200 characters (after trimming)
--   hint        text  optional, <= 100 characters
--   required    boolean
--   applies_to  text  'booking' | 'message' | 'both'
--   position    number
--   active      boolean
--
-- Additive and idempotent: one immutable validation function plus one CHECK
-- constraint. Rows without the key (every existing row) are valid.

create or replace function public.custom_questions_valid(questions jsonb)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when questions is null or jsonb_typeof(questions) = 'null' then true
    when jsonb_typeof(questions) <> 'array' then false
    when jsonb_array_length(questions) > 10 then false
    else coalesce((
      select bool_and(
        coalesce(
          jsonb_typeof(q) = 'object'
          and jsonb_typeof(q -> 'id') = 'string'
          and (q ->> 'id') ~ '^[a-z0-9_-]{1,32}$'
          and jsonb_typeof(q -> 'label') = 'string'
          and char_length(btrim(q ->> 'label')) between 1 and 200
          and (
            q -> 'hint' is null
            or jsonb_typeof(q -> 'hint') = 'null'
            or (jsonb_typeof(q -> 'hint') = 'string' and char_length(q ->> 'hint') <= 100)
          )
          and jsonb_typeof(q -> 'required') = 'boolean'
          and jsonb_typeof(q -> 'active') = 'boolean'
          and jsonb_typeof(q -> 'applies_to') = 'string'
          and (q ->> 'applies_to') in ('booking', 'message', 'both')
          and jsonb_typeof(q -> 'position') = 'number',
          false
        )
      )
      from jsonb_array_elements(questions) as q
    ), true)
    and (
      select count(distinct q ->> 'id') from jsonb_array_elements(questions) as q
    ) = jsonb_array_length(questions)
  end
$$;

comment on function public.custom_questions_valid(jsonb) is
  'INTAKE-Q-1: true when the value (agent_configs.dynamic_variable_overrides -> ''custom_questions'') is absent or a well-formed array of at most 10 custom intake questions (see migration 20260930230000).';

alter table public.agent_configs
  drop constraint if exists agent_configs_custom_questions_valid;

alter table public.agent_configs
  add constraint agent_configs_custom_questions_valid
  check (public.custom_questions_valid(dynamic_variable_overrides -> 'custom_questions'));

comment on constraint agent_configs_custom_questions_valid on public.agent_configs is
  'INTAKE-Q-1: at most 10 owner-defined custom intake questions, each well-formed (label <= 200 chars, applies_to in booking|message|both, ...).';
