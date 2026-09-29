-- MESSAGING-1 (docs/BUILD_NOTES.md, docs/design/MESSAGING_PROVIDERS.md):
-- provider-neutral messaging. Additive only.
--
-- 1. messaging_senders — the SMS-capable numbers a tenant texts FROM, one
--    row per number, each owned by exactly one provider account (Telnyx,
--    Twilio, ...), with its carrier-registration state. Becomes the source
--    of truth for "can this tenant text yet"; tenants.a2p_status is kept in
--    sync from it (compat for the text agent, dashboard and widget).
-- 2. messaging_business_profiles — the end business's legal details
--    carriers require for toll-free verification / 10DLC brand
--    registration (IRS legal name, EIN, address, contact), entered by the
--    owner on /dashboard/delivery.
-- 3. tenants.sms_provider — optional per-tenant provider override.
-- 4. messages_outbound: which provider sent it, which channel it actually
--    went out on (an SMS rerouted to the owner's email while texting isn't
--    approved), delivery receipt time, and the parent row of an owner-alert
--    fan-out (SMS + email) so the fan-out is idempotent.
-- 5. messages_inbound: provider-neutral provider/provider_message_id,
--    backfilled from twilio_message_sid.
-- 6. Guard: tenant owners could previously flip tenants.a2p_status to
--    'verified' themselves through PostgREST (table-level UPDATE grant +
--    tenants_update policy), bypassing the SMS gate. Registration columns
--    are now platform-managed only.
--
-- NOT APPLIED from this sandbox (DDL blocked). Apply BEFORE deploying the
-- MESSAGING-1 edge functions (worker-messages-outbound, worker-tick,
-- webhooks-sms, webhooks-twilio-sms, api-a2p-register), which read and
-- write these columns.

-- ---------------------------------------------------------------------
-- 1. messaging_senders
-- ---------------------------------------------------------------------

create table public.messaging_senders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  -- Adapter id ('telnyx', 'twilio', ...). Validated in code (registry.ts),
  -- not by a CHECK, so adding a provider never needs a migration.
  provider text not null,
  e164 text not null check (e164 ~ '^\+[1-9][0-9]{1,14}$'),
  kind text not null check (kind in ('toll_free', '10dlc', 'short_code')),
  -- Provider's own id for the number (Telnyx phone number id, Twilio PN SID).
  provider_number_id text,
  -- Unit the registration attaches to (Twilio Messaging Service SID,
  -- Telnyx messaging profile id).
  messaging_profile_id text,
  registration_status text not null default 'not_submitted'
    check (registration_status in ('not_submitted', 'submitted', 'in_review', 'verified', 'failed')),
  -- Toll-free verification request id / 10DLC campaign id.
  registration_ref text,
  -- 10DLC brand id (one per END BUSINESS — carriers reject a shared ISV brand).
  brand_ref text,
  failure_reason text,
  is_default boolean not null default true,
  verified_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index messaging_senders_active_e164_key
  on public.messaging_senders (e164) where released_at is null;
create unique index messaging_senders_one_default_per_tenant
  on public.messaging_senders (tenant_id) where is_default and released_at is null;
create index idx_messaging_senders_tenant on public.messaging_senders (tenant_id);

create trigger trg_messaging_senders_updated_at
  before update on public.messaging_senders
  for each row execute function public.fn_set_updated_at();

comment on table public.messaging_senders is
  'MESSAGING-1: numbers a tenant sends SMS from (may differ from the Retell voice number in phone_numbers). provider = the account that owns the number; registration_status = carrier approval (toll-free verification or 10DLC). Service-role writes only.';

alter table public.messaging_senders enable row level security;

create policy messaging_senders_select on public.messaging_senders for select
  using (tenant_id = public.fn_jwt_tenant_id() or public.fn_jwt_is_platform_admin());
-- No client insert/update/delete policy: senders are provisioned and their
-- registration status is driven by the platform (service_role) only.

-- tenants.a2p_status compat: derived from the tenant's active senders
-- whenever they change (never touched when a tenant has no sender rows at
-- all, so the legacy Twilio api-a2p-register flow keeps working unchanged).
-- A tenant whose senders were all RELEASED drops back to
-- 'pending_verification': otherwise a stale 'verified' would send the
-- worker down the legacy path (primary voice number, usually Retell-owned)
-- and every text would fail instead of being copied to the owner by email.
-- Both the old and the new tenant are recomputed when a row moves.
create or replace function public.fn_sync_tenant_a2p_status_from_senders()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
  v_status text;
begin
  for v_tenant in
    select distinct x.tenant_id
    from (values (old.tenant_id), (new.tenant_id)) as x(tenant_id)
    where x.tenant_id is not null
  loop
    select case
        when count(*) filter (where released_at is null) = 0 then
          case when count(*) > 0 then 'pending_verification' end
        when bool_or(registration_status = 'verified') filter (where released_at is null)
          then 'verified'
        when bool_or(registration_status <> 'failed') filter (where released_at is null)
          then 'pending_verification'
        else 'failed'
      end
      into v_status
    from public.messaging_senders
    where tenant_id = v_tenant;

    if v_status is not null then
      update public.tenants
      set a2p_status = v_status
      where id = v_tenant and a2p_status is distinct from v_status;
    end if;
  end loop;
  return null;
end;
$$;

comment on function public.fn_sync_tenant_a2p_status_from_senders() is
  'MESSAGING-1: keeps tenants.a2p_status (read by the text agent, dashboard and widget) in sync with messaging_senders.registration_status.';

create trigger trg_messaging_senders_sync_a2p_status
  after insert or update or delete on public.messaging_senders
  for each row execute function public.fn_sync_tenant_a2p_status_from_senders();

-- ---------------------------------------------------------------------
-- 2. messaging_business_profiles
-- ---------------------------------------------------------------------

create table public.messaging_business_profiles (
  tenant_id uuid primary key references public.tenants(id),
  legal_name text not null,
  dba_name text,
  business_type text not null
    check (business_type in ('sole_proprietor', 'llc', 'corporation', 'partnership', 'nonprofit')),
  -- 9 digits, stored without the dash. Required by carriers for every type
  -- except sole proprietor (enforced by the form schema).
  ein text check (ein is null or ein ~ '^[0-9]{9}$'),
  website_url text,
  street_line1 text,
  street_line2 text,
  city text,
  region text,
  postal_code text,
  country text not null default 'US',
  contact_first_name text,
  contact_last_name text,
  contact_email text,
  contact_phone_e164 text check (contact_phone_e164 is null or contact_phone_e164 ~ '^\+[1-9][0-9]{1,14}$'),
  monthly_volume_estimate integer check (monthly_volume_estimate is null or monthly_volume_estimate > 0),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_messaging_business_profiles_updated_at
  before update on public.messaging_business_profiles
  for each row execute function public.fn_set_updated_at();

comment on table public.messaging_business_profiles is
  'MESSAGING-1: the end business''s legal identity for carrier registration (toll-free verification / 10DLC brand). Owner/admin read+write their own row; nothing here is ever sent to a provider without the platform submitting it.';

alter table public.messaging_business_profiles enable row level security;

create policy messaging_business_profiles_select on public.messaging_business_profiles for select
  using ((tenant_id = public.fn_jwt_tenant_id() and public.fn_jwt_role() in ('owner', 'admin'))
         or public.fn_jwt_is_platform_admin());

create policy messaging_business_profiles_insert on public.messaging_business_profiles for insert
  with check (tenant_id = public.fn_jwt_tenant_id() and public.fn_jwt_role() in ('owner', 'admin'));

create policy messaging_business_profiles_update on public.messaging_business_profiles for update
  using (tenant_id = public.fn_jwt_tenant_id() and public.fn_jwt_role() in ('owner', 'admin'))
  with check (tenant_id = public.fn_jwt_tenant_id() and public.fn_jwt_role() in ('owner', 'admin'));

-- ---------------------------------------------------------------------
-- 3. tenants.sms_provider (per-tenant override) + registration-column guard
-- ---------------------------------------------------------------------

alter table public.tenants add column sms_provider text;

comment on column public.tenants.sms_provider is
  'MESSAGING-1: optional per-tenant SMS provider override (adapter id, e.g. ''telnyx''/''twilio''). Null = platform default (SMS_PROVIDER env). A messaging_senders row''s own provider always wins for that number.';

create or replace function public.fn_guard_tenant_messaging_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') and (
       new.a2p_status is distinct from old.a2p_status
    or new.a2p_brand_sid is distinct from old.a2p_brand_sid
    or new.a2p_campaign_sid is distinct from old.a2p_campaign_sid
    or new.a2p_messaging_service_sid is distinct from old.a2p_messaging_service_sid
    or new.a2p_failure_reason is distinct from old.a2p_failure_reason
    or new.sms_provider is distinct from old.sms_provider
  ) then
    raise exception 'messaging registration columns are platform-managed'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.fn_guard_tenant_messaging_columns() is
  'MESSAGING-1: a tenant session may update its own tenants row (tenants_update policy) but never its carrier-registration state or provider — otherwise an owner could mark SMS verified and bypass the send gate.';

create trigger trg_tenants_guard_messaging_columns
  before update on public.tenants
  for each row execute function public.fn_guard_tenant_messaging_columns();

-- ---------------------------------------------------------------------
-- 4. messages_outbound
-- ---------------------------------------------------------------------

alter table public.messages_outbound
  add column provider text,
  add column sent_via text check (sent_via is null or sent_via in ('sms', 'email')),
  add column delivered_at timestamptz,
  add column parent_message_id uuid references public.messages_outbound(id);

comment on column public.messages_outbound.provider is
  'MESSAGING-1: adapter id that accepted the send (telnyx/twilio/resend).';
comment on column public.messages_outbound.sent_via is
  'MESSAGING-1: channel the message actually went out on. channel=sms + sent_via=email = rerouted to the owner''s email because texting isn''t approved/configured yet.';
comment on column public.messages_outbound.parent_message_id is
  'MESSAGING-1: owner-alert fan-out — the email copy of an SMS owner alert points at the original row.';

create unique index messages_outbound_parent_channel_key
  on public.messages_outbound (parent_message_id, channel) where parent_message_id is not null;
create index idx_messages_outbound_provider_message_id
  on public.messages_outbound (provider_message_id) where provider_message_id is not null;

-- ---------------------------------------------------------------------
-- 5. messages_inbound
-- ---------------------------------------------------------------------

alter table public.messages_inbound
  add column provider text,
  add column provider_message_id text;

update public.messages_inbound
set provider = 'twilio', provider_message_id = twilio_message_sid
where twilio_message_sid is not null and provider_message_id is null;

create unique index messages_inbound_provider_message_key
  on public.messages_inbound (provider, provider_message_id) where provider_message_id is not null;

comment on column public.messages_inbound.provider_message_id is
  'MESSAGING-1: provider''s inbound message id (unique per provider). twilio_message_sid is kept for rows written before this migration.';
