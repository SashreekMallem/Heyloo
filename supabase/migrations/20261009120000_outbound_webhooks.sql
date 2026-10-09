-- OUTBOUND-1: outbound webhooks — every real booking, order and taken message
-- can be delivered, signed (Standard Webhooks), to any app the business uses
-- (Zapier, Make, n8n, any HTTPS endpoint). Additive only.
--
-- 1. outbound_destinations: up to 5 HTTPS endpoints per tenant, each with
--    the events it wants and its health (consecutive failures, last
--    success/failure, auto-disabled on 410 Gone). The signing secret lives in
--    Supabase Vault; this table holds only the Vault secret id, which tenant
--    sessions cannot even select (column-level grant).
-- 2. outbound_events: one row per business event (booking.created, ...);
--    `payload` is built ONCE by the delivery worker on the first attempt and
--    re-sent byte-identically on every retry.
-- 3. outbound_deliveries: one row per (destination, event) — the retry
--    state machine the worker-tick `outbound_webhooks` leg drives
--    (supabase/functions/_shared/outbound/delivery.ts).
-- 4. fn_outbound_enqueue + AFTER triggers on bookings / orders / call_logs:
--    zero cost for a tenant with no enabled destination for that event (one
--    indexed EXISTS); never any HTTP in a trigger; an enqueue error is
--    logged as a WARNING and never fails the booking/order/call write.
-- 5. Vault helpers (service role only): create / rotate / read a
--    destination's secret; the Vault row is deleted with the destination.
-- 6. fn_cron_internal_retention_sweep also prunes outbound_events (and, by
--    cascade, their deliveries) after 30 days.
--
-- Rule 1 (CLAUDE.md): Vault API verified 2026-10-09 against
-- supabase.com/docs/guides/database/vault and this project's catalog
-- (read-only): vault.create_secret(new_secret text, new_name text default
-- null, new_description text default '', new_key_id uuid default null)
-- returns uuid; vault.update_secret(secret_id uuid, new_secret text default
-- null, new_name text default null, new_description text default null,
-- new_key_id uuid default null) returns void; vault.decrypted_secrets view
-- (id, name, decrypted_secret, ...). The `postgres` role (owner of these
-- SECURITY DEFINER helpers; also the role edge functions connect as via
-- SUPABASE_DB_URL) holds EXECUTE on both functions and SELECT/DELETE on
-- vault.secrets / vault.decrypted_secrets. Function bodies are PL/pgSQL so
-- the migration applies even where the Vault extension is absent.

-- ---------------------------------------------------------------------
-- 1. outbound_destinations
-- ---------------------------------------------------------------------
create table public.outbound_destinations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  url text not null,
  event_types text[] not null default '{booking.created,booking.updated,booking.cancelled,order.created,order.updated,order.cancelled,message.taken}',
  enabled boolean not null default true,
  signing_secret_id uuid not null,
  disabled_reason text,
  consecutive_failures int not null default 0,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error text,
  last_alerted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outbound_destinations_id_tenant_key unique (id, tenant_id),
  constraint outbound_destinations_name_length_chk
    check (char_length(name) between 1 and 80),
  constraint outbound_destinations_url_chk
    check (url ~ '^https://\S+$' and char_length(url) <= 2048),
  constraint outbound_destinations_event_types_chk
    check (
      cardinality(event_types) >= 1
      and event_types <@ array[
        'booking.created', 'booking.updated', 'booking.cancelled',
        'order.created', 'order.updated', 'order.cancelled', 'message.taken'
      ]::text[]
    ),
  constraint outbound_destinations_disabled_reason_chk
    check (disabled_reason is null or disabled_reason in ('owner', 'gone_410')),
  constraint outbound_destinations_consecutive_failures_chk
    check (consecutive_failures >= 0),
  constraint outbound_destinations_last_error_length_chk
    check (last_error is null or char_length(last_error) <= 300)
);

create index idx_outbound_destinations_tenant on public.outbound_destinations (tenant_id);

create trigger trg_outbound_destinations_updated_at
  before update on public.outbound_destinations
  for each row execute function public.fn_set_updated_at();

comment on table public.outbound_destinations is
  'OUTBOUND-1: a tenant''s outbound webhook endpoints (max 5, enforced by api-tenant-webhooks and trg_outbound_destinations_limit). Written only by api-tenant-webhooks (owner/admin) and the delivery worker with the secret key; tenant members read their own rows except signing_secret_id.';
comment on column public.outbound_destinations.name is
  'Owner''s label for the destination, e.g. "Zapier - kitchen sheet" (1-80 chars).';
comment on column public.outbound_destinations.url is
  'HTTPS endpoint the signed POST goes to (<= 2048 chars). Public-host checks (no private/internal addresses) run at create and on every send (_shared/safe-fetch.ts).';
comment on column public.outbound_destinations.event_types is
  'Events this destination receives; subset of booking.created|booking.updated|booking.cancelled|order.created|order.updated|order.cancelled|message.taken (test.ping is always allowed via "Send test").';
comment on column public.outbound_destinations.enabled is
  'false = nothing new is enqueued and pending deliveries are cancelled when claimed. Turned off by the owner (disabled_reason owner) or automatically on HTTP 410 Gone (gone_410).';
comment on column public.outbound_destinations.signing_secret_id is
  'vault.secrets id of the whsec_ signing secret (plaintext never stored here). Not selectable by authenticated. The Vault row is deleted with the destination (trg_outbound_destinations_drop_secret).';
comment on column public.outbound_destinations.disabled_reason is
  'Why enabled is false: owner | gone_410 (the receiving app answered 410 Gone). Null while enabled.';
comment on column public.outbound_destinations.consecutive_failures is
  'Failed attempts since the last success (reset on success and when the owner re-enables).';
comment on column public.outbound_destinations.last_success_at is
  'When an attempt to this destination last got a 2xx.';
comment on column public.outbound_destinations.last_failure_at is
  'When an attempt to this destination last failed.';
comment on column public.outbound_destinations.last_error is
  'Short owner-safe text of the last failure ("HTTP 500", "Timed out after 5s", "Could not connect").';
comment on column public.outbound_destinations.last_alerted_at is
  'When the owner was last alerted (webhook_failing) about this destination; at most one alert per 24 h.';

-- Max 5 destinations per tenant (the edge function checks first for a
-- friendly error; this closes the concurrent-create race).
create or replace function public.fn_outbound_destinations_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('outbound_destinations:' || new.tenant_id::text, 0));
  if (select count(*) from public.outbound_destinations d where d.tenant_id = new.tenant_id) >= 5 then
    raise exception 'outbound destination limit reached'
      using errcode = 'P0001', hint = 'outbound_destination_limit';
  end if;
  return new;
end;
$$;

comment on function public.fn_outbound_destinations_limit() is
  'OUTBOUND-1: BEFORE INSERT guard, at most 5 outbound_destinations per tenant (per-tenant advisory lock against concurrent creates).';

create trigger trg_outbound_destinations_limit
  before insert on public.outbound_destinations
  for each row execute function public.fn_outbound_destinations_limit();

-- ---------------------------------------------------------------------
-- 2. outbound_events
-- ---------------------------------------------------------------------
create table public.outbound_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  event_type text not null,
  entity_type text not null,
  entity_id uuid,
  occurred_at timestamptz not null default now(),
  payload jsonb,
  created_at timestamptz not null default now(),
  constraint outbound_events_id_tenant_key unique (id, tenant_id),
  constraint outbound_events_event_type_chk
    check (event_type in (
      'booking.created', 'booking.updated', 'booking.cancelled',
      'order.created', 'order.updated', 'order.cancelled', 'message.taken', 'test.ping'
    )),
  constraint outbound_events_entity_type_chk
    check (entity_type in ('booking', 'order', 'call_log', 'test')),
  constraint outbound_events_test_pairing_chk
    check ((event_type = 'test.ping') = (entity_type = 'test')),
  constraint outbound_events_entity_id_chk
    check (entity_type = 'test' or entity_id is not null)
);

create index idx_outbound_events_tenant_created on public.outbound_events (tenant_id, created_at desc);
create index idx_outbound_events_created on public.outbound_events (created_at);

comment on table public.outbound_events is
  'OUTBOUND-1: one row per business event to deliver (fan-out rows in outbound_deliveries). Inserted by fn_outbound_enqueue (triggers) and by api-tenant-webhooks for test.ping. Pruned after 30 days by fn_cron_internal_retention_sweep. Tenant members read their own; only the service role writes.';
comment on column public.outbound_events.id is
  'Standard Webhooks webhook-id is ''evt_'' || replace(id::text, ''-'', '''') — constant across retries and destinations, so receivers can dedupe.';
comment on column public.outbound_events.event_type is
  'booking.created|booking.updated|booking.cancelled|order.created|order.updated|order.cancelled|message.taken|test.ping.';
comment on column public.outbound_events.entity_type is
  'booking | order | call_log (message.taken) | test (test.ping, no entity).';
comment on column public.outbound_events.entity_id is
  'bookings.id / orders.id / call_logs.id of the event; null only for test.ping.';
comment on column public.outbound_events.occurred_at is
  'When the event happened (the payload''s top-level timestamp).';
comment on column public.outbound_events.payload is
  'The JSON body sent (contract v1, packages/canonical-types/src/outbound-webhooks.ts). Built once by the worker on the first attempt from the then-current rows; every retry re-sends it unchanged. Null until then.';

-- ---------------------------------------------------------------------
-- 3. outbound_deliveries
-- ---------------------------------------------------------------------
create table public.outbound_deliveries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  destination_id uuid not null,
  event_id uuid not null,
  status text not null default 'pending',
  attempt_count int not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  last_status_code int,
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Composite FKs: a delivery can only join a destination and an event of
  -- its OWN tenant.
  constraint outbound_deliveries_destination_fk
    foreign key (destination_id, tenant_id)
    references public.outbound_destinations (id, tenant_id) on delete cascade,
  constraint outbound_deliveries_event_fk
    foreign key (event_id, tenant_id)
    references public.outbound_events (id, tenant_id) on delete cascade,
  constraint outbound_deliveries_destination_event_key unique (destination_id, event_id),
  constraint outbound_deliveries_status_chk
    check (status in ('pending', 'sending', 'retrying', 'delivered', 'failed', 'cancelled')),
  constraint outbound_deliveries_attempt_count_chk check (attempt_count >= 0),
  constraint outbound_deliveries_last_error_length_chk
    check (last_error is null or char_length(last_error) <= 300)
);

create index idx_outbound_deliveries_due
  on public.outbound_deliveries (next_attempt_at)
  where status in ('pending', 'retrying', 'sending');
create index idx_outbound_deliveries_tenant_created
  on public.outbound_deliveries (tenant_id, created_at desc);
create index idx_outbound_deliveries_event on public.outbound_deliveries (event_id);

create trigger trg_outbound_deliveries_updated_at
  before update on public.outbound_deliveries
  for each row execute function public.fn_set_updated_at();

comment on table public.outbound_deliveries is
  'OUTBOUND-1: delivery state per (destination, event): pending -> sending -> delivered | retrying -> ... -> failed, or cancelled (destination turned off / entity gone). Driven by the worker-tick outbound_webhooks leg. Tenant members read their own (the dashboard delivery log); only the service role writes.';
comment on column public.outbound_deliveries.status is
  'pending | sending (leased by a worker until locked_until) | retrying (waiting for next_attempt_at) | delivered | failed (gave up after 8 attempts, or 410 Gone) | cancelled.';
comment on column public.outbound_deliveries.attempt_count is
  'Attempts made so far, incremented when an attempt is leased (a crashed attempt counts).';
comment on column public.outbound_deliveries.next_attempt_at is
  'Earliest time the next attempt may be leased (backoff 1m, 5m, 30m, 2h, 5h, 10h, 24h with +/-10% jitter; Retry-After honored up to 24 h).';
comment on column public.outbound_deliveries.locked_until is
  'Lease expiry while status = sending; a lease that expires (worker crash) is re-claimed.';
comment on column public.outbound_deliveries.last_status_code is
  'HTTP status of the last attempt; null when no HTTP answer (timeout, connection error, blocked address).';
comment on column public.outbound_deliveries.last_error is
  'Short owner-safe text of the last failure; null after delivery.';
comment on column public.outbound_deliveries.delivered_at is
  'When a 2xx was received.';

-- ---------------------------------------------------------------------
-- RLS + privileges (template: delivery_address_checks, 20261001130000)
-- ---------------------------------------------------------------------
alter table public.outbound_destinations enable row level security;
alter table public.outbound_events enable row level security;
alter table public.outbound_deliveries enable row level security;

create policy outbound_destinations_select on public.outbound_destinations for select
  using (tenant_id = public.fn_jwt_tenant_id() or public.fn_jwt_is_platform_admin());
create policy outbound_events_select on public.outbound_events for select
  using (tenant_id = public.fn_jwt_tenant_id() or public.fn_jwt_is_platform_admin());
create policy outbound_deliveries_select on public.outbound_deliveries for select
  using (tenant_id = public.fn_jwt_tenant_id() or public.fn_jwt_is_platform_admin());

-- No client insert/update/delete policy: writes go through api-tenant-webhooks
-- and the worker with the secret key. Table privileges are revoked too
-- (defense in depth).
revoke insert, update, delete, truncate on public.outbound_destinations from authenticated, anon;
revoke insert, update, delete, truncate on public.outbound_events from authenticated, anon;
revoke insert, update, delete, truncate on public.outbound_deliveries from authenticated, anon;
revoke select on public.outbound_destinations from anon;
revoke select on public.outbound_events from anon;
revoke select on public.outbound_deliveries from anon;

-- Owners never read the Vault secret id: table-level SELECT is revoked and
-- re-granted per column (column privileges cannot be revoked from under a
-- table-level grant; same pattern as adapter_connections, QA-1 SEC-13).
revoke select on public.outbound_destinations from authenticated;
grant select (
  id, tenant_id, name, url, event_types, enabled, disabled_reason, consecutive_failures,
  last_success_at, last_failure_at, last_error, last_alerted_at, created_at, updated_at
) on public.outbound_destinations to authenticated;

-- ---------------------------------------------------------------------
-- 5. Vault helpers (service role only)
-- ---------------------------------------------------------------------
create or replace function public.fn_outbound_secret_create(p_secret text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_secret is null or p_secret !~ '^whsec_[A-Za-z0-9+/]{32,}={0,2}$' then
    raise exception 'invalid outbound webhook signing secret' using errcode = '22023';
  end if;
  return vault.create_secret(
    p_secret,
    'outbound_webhook_' || gen_random_uuid()::text,
    'OUTBOUND-1 outbound webhook signing secret'
  );
end;
$$;

comment on function public.fn_outbound_secret_create(text) is
  'OUTBOUND-1: stores a whsec_ signing secret in Supabase Vault under a unique outbound_webhook_<uuid> name and returns its id. Service role only.';

create or replace function public.fn_outbound_secret_rotate(p_id uuid, p_secret text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_secret is null or p_secret !~ '^whsec_[A-Za-z0-9+/]{32,}={0,2}$' then
    raise exception 'invalid outbound webhook signing secret' using errcode = '22023';
  end if;
  if not exists (
    select 1 from vault.secrets s where s.id = p_id and s.name like 'outbound\_webhook\_%'
  ) then
    return false;
  end if;
  perform vault.update_secret(p_id, p_secret);
  return true;
end;
$$;

comment on function public.fn_outbound_secret_rotate(uuid, text) is
  'OUTBOUND-1: replaces an outbound webhook signing secret in Vault (only secrets named outbound_webhook_*). Returns false when no such secret exists. Service role only.';

create or replace function public.fn_outbound_secret_read(p_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return (
    select ds.decrypted_secret
    from vault.decrypted_secrets ds
    where ds.id = p_id and ds.name like 'outbound\_webhook\_%'
  );
end;
$$;

comment on function public.fn_outbound_secret_read(uuid) is
  'OUTBOUND-1: decrypted outbound webhook signing secret (only secrets named outbound_webhook_*), for the delivery worker to sign with. Service role only; never exposed to tenant sessions.';

create or replace function public.fn_outbound_destination_drop_secret()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets s
  where s.id = old.signing_secret_id and s.name like 'outbound\_webhook\_%';
  return old;
end;
$$;

comment on function public.fn_outbound_destination_drop_secret() is
  'OUTBOUND-1: AFTER DELETE on outbound_destinations — deletes the destination''s Vault secret (only outbound_webhook_* names) so no orphan secret outlives it, including on tenant cascade deletes.';

create trigger trg_outbound_destinations_drop_secret
  after delete on public.outbound_destinations
  for each row execute function public.fn_outbound_destination_drop_secret();

revoke execute on function public.fn_outbound_secret_create(text) from public, anon, authenticated;
revoke execute on function public.fn_outbound_secret_rotate(uuid, text) from public, anon, authenticated;
revoke execute on function public.fn_outbound_secret_read(uuid) from public, anon, authenticated;
grant execute on function public.fn_outbound_secret_create(text) to service_role;
grant execute on function public.fn_outbound_secret_rotate(uuid, text) to service_role;
grant execute on function public.fn_outbound_secret_read(uuid) to service_role;

-- ---------------------------------------------------------------------
-- 4. Enqueue + triggers
-- ---------------------------------------------------------------------
create or replace function public.fn_outbound_enqueue(
  p_tenant_id uuid,
  p_event_type text,
  p_entity_type text,
  p_entity_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
begin
  if not exists (
    select 1 from public.outbound_destinations d
    where d.tenant_id = p_tenant_id and d.enabled and p_event_type = any (d.event_types)
  ) then
    return;
  end if;

  insert into public.outbound_events (tenant_id, event_type, entity_type, entity_id)
  values (p_tenant_id, p_event_type, p_entity_type, p_entity_id)
  returning id into v_event_id;

  insert into public.outbound_deliveries (tenant_id, destination_id, event_id)
  select p_tenant_id, d.id, v_event_id
  from public.outbound_destinations d
  where d.tenant_id = p_tenant_id and d.enabled and p_event_type = any (d.event_types)
  on conflict (destination_id, event_id) do nothing;
end;
$$;

comment on function public.fn_outbound_enqueue(uuid, text, text, uuid) is
  'OUTBOUND-1: records one outbound event and one pending delivery per enabled destination of that tenant subscribed to it; returns at once (nothing written) when there is none. No HTTP. SECURITY DEFINER, empty search_path; not callable by tenant sessions.';

revoke execute on function public.fn_outbound_enqueue(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.fn_outbound_enqueue(uuid, text, text, uuid) to service_role;

-- bookings: a "real" booking is anything but a motel deposit hold
-- (status 'scheduled' with hold_expires_at set).
create or replace function public.fn_outbound_on_booking()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new_real boolean := not (new.status = 'scheduled' and new.hold_expires_at is not null);
  v_old_real boolean;
  v_event text;
begin
  if new.is_test then
    return null;
  end if;

  if tg_op = 'INSERT' then
    if v_new_real and new.status <> 'cancelled' then
      v_event := 'booking.created';
    end if;
  else
    v_old_real := not (old.status = 'scheduled' and old.hold_expires_at is not null);
    if not v_old_real then
      if v_new_real and new.status <> 'cancelled' then
        v_event := 'booking.created';
      end if;
    elsif new.status = 'cancelled' then
      if old.status <> 'cancelled' then
        v_event := 'booking.cancelled';
      end if;
    elsif v_new_real and (
      new.start_at is distinct from old.start_at
      or new.end_at is distinct from old.end_at
      or new.status is distinct from old.status
      or new.party_size is distinct from old.party_size
      or new.resource_id is distinct from old.resource_id
      or new.offering_id is distinct from old.offering_id
    ) then
      v_event := 'booking.updated';
    end if;
  end if;

  if v_event is null or not exists (
    select 1 from public.outbound_destinations d
    where d.tenant_id = new.tenant_id and d.enabled and v_event = any (d.event_types)
  ) then
    return null;
  end if;

  begin
    perform public.fn_outbound_enqueue(new.tenant_id, v_event, 'booking', new.id);
  exception when others then
    raise warning 'OUTBOUND-1 outbound webhook enqueue failed for booking %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

comment on function public.fn_outbound_on_booking() is
  'OUTBOUND-1: AFTER trigger on bookings — booking.created (a real booking appears, incl. a deposit hold becoming real), booking.cancelled (a real booking is cancelled), booking.updated (time/status/party/resource/service of a real booking changes). Skips is_test rows. Never fails the booking write.';

create trigger trg_outbound_bookings
  after insert or update of status, start_at, end_at, party_size, resource_id, offering_id, hold_expires_at
  on public.bookings
  for each row
  when (new.is_test is not true)
  execute function public.fn_outbound_on_booking();

create or replace function public.fn_outbound_on_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event text;
begin
  if new.is_test then
    return null;
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'cancelled' then
      v_event := 'order.created';
    end if;
  elsif new.status is distinct from old.status then
    v_event := case when new.status = 'cancelled' then 'order.cancelled' else 'order.updated' end;
  end if;

  if v_event is null or not exists (
    select 1 from public.outbound_destinations d
    where d.tenant_id = new.tenant_id and d.enabled and v_event = any (d.event_types)
  ) then
    return null;
  end if;

  begin
    perform public.fn_outbound_enqueue(new.tenant_id, v_event, 'order', new.id);
  exception when others then
    raise warning 'OUTBOUND-1 outbound webhook enqueue failed for order %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

comment on function public.fn_outbound_on_order() is
  'OUTBOUND-1: AFTER trigger on orders — order.created on insert, order.cancelled / order.updated when status changes. Skips is_test rows. Never fails the order write.';

create trigger trg_outbound_orders
  after insert or update of status
  on public.orders
  for each row
  when (new.is_test is not true)
  execute function public.fn_outbound_on_order();

create or replace function public.fn_outbound_on_call_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_test_call or coalesce(btrim(new.message_text), '') = '' then
    return null;
  end if;
  if tg_op = 'UPDATE' and coalesce(btrim(old.message_text), '') <> '' then
    return null;
  end if;

  if not exists (
    select 1 from public.outbound_destinations d
    where d.tenant_id = new.tenant_id and d.enabled and 'message.taken' = any (d.event_types)
  ) then
    return null;
  end if;

  begin
    perform public.fn_outbound_enqueue(new.tenant_id, 'message.taken', 'call_log', new.id);
  exception when others then
    raise warning 'OUTBOUND-1 outbound webhook enqueue failed for call %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

comment on function public.fn_outbound_on_call_log() is
  'OUTBOUND-1: AFTER trigger on call_logs — message.taken when message_text first becomes non-empty (take_message). Skips is_test_call rows. Never fails the call_logs write.';

create trigger trg_outbound_call_logs
  after insert or update of message_text
  on public.call_logs
  for each row
  when (new.is_test_call is not true and new.message_text is not null)
  execute function public.fn_outbound_on_call_log();

-- Trigger functions are never called directly (EXECUTE is checked when a
-- trigger is created, not when it fires), and a SECURITY DEFINER function in
-- public must never be executable by anon (SEC-14,
-- supabase/tests/qa1_backend_hardening.sql). Functions created here get the
-- PUBLIC default grant plus Supabase's default anon/authenticated grants, so
-- revoke them explicitly.
revoke execute on function public.fn_outbound_on_booking() from public, anon, authenticated;
revoke execute on function public.fn_outbound_on_order() from public, anon, authenticated;
revoke execute on function public.fn_outbound_on_call_log() from public, anon, authenticated;
revoke execute on function public.fn_outbound_destination_drop_secret() from public, anon, authenticated;
revoke execute on function public.fn_outbound_destinations_limit() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. Retention: outbound_events (+ deliveries by cascade) after 30 days.
--    Same body as 20260910093000 (verified identical to the live function
--    2026-10-09) plus the outbound_events line.
-- ---------------------------------------------------------------------
create or replace function public.fn_cron_internal_retention_sweep()
returns void language plpgsql as $$
begin
  -- DB_AUDIT.md DB-M1: neither webhook_events (one row per webhook delivery,
  -- every provider, forever) nor tool_health (one row per /voice/tools call,
  -- the highest-write-volume table by design) had any pruning strategy.
  -- tool_health is only ever queried over trailing-minutes windows
  -- (job-alert-evaluation's tool_failure_spike rule reads the last 5
  -- minutes) so 14 days leaves enormous headroom for ad hoc debugging;
  -- webhook_events is kept longer (90 days) since it doubles as an audit
  -- trail for support/compliance investigation of a specific delivery.
  -- This is a platform-wide window (not per-tenant, unlike
  -- tenants.retention_days, which governs Storage recordings — a distinct,
  -- separately-tracked gap, see this migration's header re: cluster F).
  delete from public.webhook_events where created_at < now() - interval '90 days';
  delete from public.tool_health where occurred_at < now() - interval '14 days';
  -- OUTBOUND-1: outbound webhook events and their delivery log, 30 days (the
  -- longest retry schedule ends ~42 hours after an event).
  delete from public.outbound_events where created_at < now() - interval '30 days';
end;
$$;

comment on function public.fn_cron_internal_retention_sweep() is
  'Scheduled 05:30 UTC daily — DB_AUDIT.md DB-M1''s retention fix for webhook_events/tool_health specifically (distinct from BACKEND_SPEC §8''s Storage-recording "Retention sweep" job, which needs the Storage API and therefore an edge function — tracked separately in docs/audit/FIX_REQUESTS.md for cluster F, not scheduled here). OUTBOUND-1: also prunes outbound_events (deliveries cascade) after 30 days.';
