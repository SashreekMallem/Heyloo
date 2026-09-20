-- CALL-3 (docs/BUILD_NOTES.md): repairs jsonb columns that were
-- double-JSON-encoded by `${JSON.stringify(x)}::jsonb` call sites (fixed in
-- this same task) — under postgres.js with `prepare: true`, that pattern's
-- own learned-type serializer re-serializes an already-stringified value, so
-- the column ends up holding a jsonb STRING (the JSON text, quoted) instead
-- of the intended object/array.
--
-- Affected tables/columns (every jsonb column any of this task's fixed call
-- sites writes to): admin_actions.before/after, agent_templates.states/
-- transitions/global_intents/tools, platform_settings.value,
-- adapter_connections.metadata, demo_sessions.scraped_summary/
-- agent_config_snapshot, lead_callback_requests.metadata,
-- leads.enrichment/phone_complaint_evidence, messages_outbound.payload,
-- agent_configs.compiled_config, alerts.payload, churn_scores.factors,
-- cost_events.raw, call_logs.extracted_entities/transcript/
-- structured_booking_payload, bookings.structured_payload,
-- customers.consent/metadata, orders.items/delivery_address,
-- text_conversations.structured_state/recent_turns, webhook_events.payload.
--
-- Idempotent: a repaired row's jsonb_typeof is no longer 'string', so
-- re-running this file is a no-op on every already-repaired row. Additive:
-- only UPDATEs existing rows via a helper function this file creates and
-- drops again within itself — no schema change survives it.
--
-- Guard: `jsonb_typeof(col) = 'string'` alone is not enough — a column
-- could legitimately hold a plain jsonb string scalar (e.g. `'"note"'::jsonb`,
-- not a JSON document at all). This only rewrites a row when the string's
-- own text content (`col #>> '{}'`) itself parses as jsonb AND that parsed
-- value is an object or array (`jsonb_typeof(...) in ('object','array')`) —
-- exactly the shape every double-encoding site above always produces, and
-- never a legitimate free-text string value. A string whose content fails
-- to parse as JSON at all, or parses to a scalar (string/number/boolean/
-- null), is left untouched.

create or replace function public._call3_try_unwrap_jsonb_document(input jsonb)
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

update public.admin_actions
  set before = public._call3_try_unwrap_jsonb_document(before)
  where jsonb_typeof(before) = 'string';
update public.admin_actions
  set after = public._call3_try_unwrap_jsonb_document(after)
  where jsonb_typeof(after) = 'string';

update public.agent_templates
  set states = public._call3_try_unwrap_jsonb_document(states)
  where jsonb_typeof(states) = 'string';
update public.agent_templates
  set transitions = public._call3_try_unwrap_jsonb_document(transitions)
  where jsonb_typeof(transitions) = 'string';
update public.agent_templates
  set global_intents = public._call3_try_unwrap_jsonb_document(global_intents)
  where jsonb_typeof(global_intents) = 'string';
update public.agent_templates
  set tools = public._call3_try_unwrap_jsonb_document(tools)
  where jsonb_typeof(tools) = 'string';

update public.platform_settings
  set value = public._call3_try_unwrap_jsonb_document(value)
  where jsonb_typeof(value) = 'string';

update public.adapter_connections
  set metadata = public._call3_try_unwrap_jsonb_document(metadata)
  where jsonb_typeof(metadata) = 'string';

update public.demo_sessions
  set scraped_summary = public._call3_try_unwrap_jsonb_document(scraped_summary)
  where jsonb_typeof(scraped_summary) = 'string';
update public.demo_sessions
  set agent_config_snapshot = public._call3_try_unwrap_jsonb_document(agent_config_snapshot)
  where jsonb_typeof(agent_config_snapshot) = 'string';

update public.lead_callback_requests
  set metadata = public._call3_try_unwrap_jsonb_document(metadata)
  where jsonb_typeof(metadata) = 'string';

update public.leads
  set enrichment = public._call3_try_unwrap_jsonb_document(enrichment)
  where jsonb_typeof(enrichment) = 'string';
update public.leads
  set phone_complaint_evidence = public._call3_try_unwrap_jsonb_document(phone_complaint_evidence)
  where jsonb_typeof(phone_complaint_evidence) = 'string';

update public.messages_outbound
  set payload = public._call3_try_unwrap_jsonb_document(payload)
  where jsonb_typeof(payload) = 'string';

update public.agent_configs
  set compiled_config = public._call3_try_unwrap_jsonb_document(compiled_config)
  where jsonb_typeof(compiled_config) = 'string';

update public.alerts
  set payload = public._call3_try_unwrap_jsonb_document(payload)
  where jsonb_typeof(payload) = 'string';

update public.churn_scores
  set factors = public._call3_try_unwrap_jsonb_document(factors)
  where jsonb_typeof(factors) = 'string';

update public.cost_events
  set raw = public._call3_try_unwrap_jsonb_document(raw)
  where jsonb_typeof(raw) = 'string';

update public.call_logs
  set extracted_entities = public._call3_try_unwrap_jsonb_document(extracted_entities)
  where jsonb_typeof(extracted_entities) = 'string';
update public.call_logs
  set transcript = public._call3_try_unwrap_jsonb_document(transcript)
  where jsonb_typeof(transcript) = 'string';
update public.call_logs
  set structured_booking_payload = public._call3_try_unwrap_jsonb_document(structured_booking_payload)
  where jsonb_typeof(structured_booking_payload) = 'string';

update public.bookings
  set structured_payload = public._call3_try_unwrap_jsonb_document(structured_payload)
  where jsonb_typeof(structured_payload) = 'string';

update public.customers
  set consent = public._call3_try_unwrap_jsonb_document(consent)
  where jsonb_typeof(consent) = 'string';
update public.customers
  set metadata = public._call3_try_unwrap_jsonb_document(metadata)
  where jsonb_typeof(metadata) = 'string';

update public.orders
  set items = public._call3_try_unwrap_jsonb_document(items)
  where jsonb_typeof(items) = 'string';
update public.orders
  set delivery_address = public._call3_try_unwrap_jsonb_document(delivery_address)
  where jsonb_typeof(delivery_address) = 'string';

update public.text_conversations
  set structured_state = public._call3_try_unwrap_jsonb_document(structured_state)
  where jsonb_typeof(structured_state) = 'string';
update public.text_conversations
  set recent_turns = public._call3_try_unwrap_jsonb_document(recent_turns)
  where jsonb_typeof(recent_turns) = 'string';

update public.webhook_events
  set payload = public._call3_try_unwrap_jsonb_document(payload)
  where jsonb_typeof(payload) = 'string';

drop function public._call3_try_unwrap_jsonb_document(jsonb);
