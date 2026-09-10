-- Add 'airtable' to adapter_connections.provider / adapter_sync_state.provider
-- CHECK constraints (additive — docs/audit/FIX_REQUESTS.md, cluster C ask).
-- Never edit 20260907160000_t7_adapter_connections.sql after it's applied
-- (CLAUDE.md Rule 2) — this drops + re-adds each column CHECK instead.
--
-- apps/web's real Airtable OAuth2+PKCE connect/callback flow
-- (apps/web/src/app/api/tenant/delivery/airtable/**) upserts into
-- adapter_connections with provider = 'airtable', and
-- worker-adapter-push/handler.ts's pushToAirtable branch reads that same
-- row and upserts adapter_sync_state with provider = 'airtable' on every
-- successful push — both currently fail the CHECK constraint below until
-- this lands.
--
-- Constraint names were never declared explicitly in the original inline
-- `check (...)` column clauses, so this looks up Postgres's actual
-- auto-generated name via pg_constraint at apply time rather than
-- hardcoding a guess (same caution as the referral_payouts follow-up
-- migration filed alongside this one).

do $$
declare
  v_conname text;
begin
  select conname into v_conname
  from pg_constraint
  where conrelid = 'public.adapter_connections'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%provider%';
  if v_conname is not null then
    execute format('alter table public.adapter_connections drop constraint %I', v_conname);
  end if;
end;
$$;

alter table public.adapter_connections
  add constraint adapter_connections_provider_check
  check (provider in ('shopmonkey', 'ezyvet', 'google_calendar', 'square', 'airtable'));

do $$
declare
  v_conname text;
begin
  select conname into v_conname
  from pg_constraint
  where conrelid = 'public.adapter_sync_state'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%provider%';
  if v_conname is not null then
    execute format('alter table public.adapter_sync_state drop constraint %I', v_conname);
  end if;
end;
$$;

alter table public.adapter_sync_state
  add constraint adapter_sync_state_provider_check
  check (provider in ('shopmonkey', 'ezyvet', 'google_calendar', 'square', 'airtable'));
