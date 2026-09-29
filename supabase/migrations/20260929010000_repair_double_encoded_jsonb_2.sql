-- JSONB-2 (docs/BUILD_NOTES.md): repairs jsonb columns still holding a
-- double-JSON-encoded value (jsonb_typeof = 'string' whose text is itself a
-- JSON object/array), found by a live sweep of every public jsonb column
-- after CALL-3's own repair (20260920190000_repair_double_encoded_jsonb.sql):
--
--   agent_regression_runs.failures   72 rows  (job-agent-regression still used
--                                              `${JSON.stringify(x)}::jsonb`
--                                              — fixed in JSONB-2's code)
--   alerts.payload                   44 rows  (agent_regression_* alerts from
--                                              the same job's second
--                                              JSON.stringify site)
--   call_logs.extracted_entities      6 rows  (voice-events, written before
--                                              the fixed function was live)
--   call_logs.transcript              2 rows  (same)
--   resources.metadata                2 rows  (api-admin-provision-test-tenant,
--                                              written before its fix)
--
-- agent_regression_runs.resume_state (same job, same bug) had 0 corrupted rows
-- live; it is included so a re-run after any future recurrence still heals it.
--
-- Same guard and idempotency as the CALL-3 repair: a row is rewritten only
-- when the jsonb string's own text parses as JSON AND the parsed value is an
-- object or array (never a legitimate free-text jsonb string scalar, never
-- text that is not valid JSON). A repaired row is no longer
-- jsonb_typeof = 'string', so re-running this file is a no-op. Additive: only
-- UPDATEs existing rows through a helper this file creates and drops again;
-- no schema change survives it.

create or replace function public._jsonb2_try_unwrap_jsonb_document(input jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  parsed jsonb;
begin
  if jsonb_typeof(input) is distinct from 'string' then
    return input;
  end if;
  begin
    parsed := (input #>> '{}')::jsonb;
  exception when others then
    return input; -- not valid JSON text at all — leave untouched
  end;
  if jsonb_typeof(parsed) in ('object', 'array') then
    return parsed;
  end if;
  return input; -- a legitimate string-typed jsonb scalar — leave untouched
end;
$$;

update public.agent_regression_runs
  set failures = public._jsonb2_try_unwrap_jsonb_document(failures)
  where jsonb_typeof(failures) = 'string';
update public.agent_regression_runs
  set resume_state = public._jsonb2_try_unwrap_jsonb_document(resume_state)
  where jsonb_typeof(resume_state) = 'string';

update public.alerts
  set payload = public._jsonb2_try_unwrap_jsonb_document(payload)
  where jsonb_typeof(payload) = 'string';

update public.call_logs
  set extracted_entities = public._jsonb2_try_unwrap_jsonb_document(extracted_entities)
  where jsonb_typeof(extracted_entities) = 'string';
update public.call_logs
  set transcript = public._jsonb2_try_unwrap_jsonb_document(transcript)
  where jsonb_typeof(transcript) = 'string';

update public.resources
  set metadata = public._jsonb2_try_unwrap_jsonb_document(metadata)
  where jsonb_typeof(metadata) = 'string';

drop function public._jsonb2_try_unwrap_jsonb_document(jsonb);
