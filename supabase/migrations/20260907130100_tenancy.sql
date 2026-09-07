-- Tenancy, membership, admin domain. BACKEND_SPEC.md §1.1.
-- MASTER_SPEC.md §3.8/§3.9 and §2 fold in: tenants.avg_transaction_value_cents,
-- tenants.review_url + review_request_enabled, tenants.voice_reminders_enabled
-- (feeds §3.6 reminder job), tenants.a2p_status (BACKEND_SPEC §10.1 DECIDE,
-- resolved here as a tenants column rather than a new table since it's a
-- single-value per-tenant state machine, not a table with its own identity),
-- and memberships.last_seen_notifications_at (notification-center derived
-- feed, MASTER_SPEC §2).

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  vertical text not null
    check (vertical in ('auto','vet','legal','dental',
                         'real_estate','motel','restaurant','generic')),
  business_type text,
  plan_code text not null default 'standard',
  price_version text not null default 'v1',
  status text not null default 'trialing'
    check (status in ('trialing','active','past_due','paused','canceled')),
  timezone text not null default 'America/New_York',
  business_hours jsonb not null default '{}'::jsonb,
  hours_exceptions jsonb not null default '[]'::jsonb,
  branding jsonb not null default '{}'::jsonb,
  language_config jsonb not null default '{"primary":"en","bilingual":false}'::jsonb,
  retention_days int not null default 30,
  stripe_customer_id text,
  stripe_subscription_id text,
  referrer_partner_id uuid,
  referral_link_id uuid,
  owner_test_phone text,
  manual_mode boolean not null default false,
  manual_mode_enabled_at timestamptz,
  usage_hard_cap_minutes int,
  seasonal_pause boolean not null default false,
  seasonal_pause_resumes_at date,
  -- MASTER_SPEC §3.8 — feeds the weekly value email "~$X saved" and the
  -- overview stat; not-null with a per-vertical default filled by
  -- fn_default_tenant_avg_ticket() (functions_triggers migration) rather
  -- than a single scalar column default, since the default varies by
  -- vertical; tenant-editable thereafter.
  avg_transaction_value_cents int not null,
  -- MASTER_SPEC §3.9 — review-request job reads this + the enabled toggle.
  review_url text,
  review_request_enabled boolean not null default false,
  -- MASTER_SPEC §3.6 — reminder-scheduler job gate for voice (vs SMS-only) reminders.
  voice_reminders_enabled boolean not null default false,
  -- BACKEND_SPEC §10.1 DECIDE — A2P 10DLC campaign vetting state; the
  -- messages_outbound queue worker checks this before attempting SMS and
  -- routes to email while pending, per G4.
  a2p_status text not null default 'pending_verification'
    check (a2p_status in ('pending_verification','verified','failed')),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.tenants.business_hours is
  'Weekly schedule, tenant-tz local time, 24h: {"mon":[{"open":"08:00","close":"18:00"}], "sun":[]}';
comment on column public.tenants.hours_exceptions is
  'Holiday/one-off closures & special hours (G23): [{"date":"2026-12-25","closed":true,"note":"Christmas"}, {"date":"2026-12-24","hours":[{"open":"08:00","close":"13:00"}]}]';

create unique index tenants_slug_key on public.tenants (slug);
create unique index tenants_stripe_customer_id_key on public.tenants (stripe_customer_id) where stripe_customer_id is not null;
create index idx_tenants_vertical on public.tenants (vertical);
create index idx_tenants_status on public.tenants (status) where deleted_at is null;

create trigger trg_tenants_updated_at
  before update on public.tenants
  for each row execute function public.fn_set_updated_at();

-- memberships ----------------------------------------------------------

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  user_id uuid not null references auth.users(id),
  role text not null check (role in ('owner','admin','member')),
  invited_email text,
  invited_at timestamptz,
  accepted_at timestamptz,
  -- MASTER_SPEC §2 — notification center is a derived feed over existing
  -- tables (bookings/orders/support_requests/etc.) rather than its own
  -- notifications table; this timestamp is the read-marker.
  last_seen_notifications_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint memberships_tenant_user_unique unique (tenant_id, user_id)
);

create index idx_memberships_user_id on public.memberships (user_id);
create index idx_memberships_tenant_id on public.memberships (tenant_id);

-- platform_admins --------------------------------------------------------

create table public.platform_admins (
  user_id uuid primary key references auth.users(id),
  role text not null check (role in ('superadmin','support','finance')),
  aal2_required boolean not null default true,
  created_at timestamptz not null default now()
);

-- admin_actions (audit log, G15) -----------------------------------------

create table public.admin_actions (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references auth.users(id),
  action text not null,
  target_type text not null
    check (target_type in ('tenant','call','booking','order','referral',
                            'agent_template','support_request','payout',
                            'campaign','flag','other')),
  target_id uuid,
  before jsonb,
  after jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create index idx_admin_actions_target on public.admin_actions (target_type, target_id);
create index idx_admin_actions_admin_created on public.admin_actions (admin_user_id, created_at desc);

comment on table public.admin_actions is
  'Append-only audit log. No UPDATE/DELETE grants to anyone but service_role (enforced at the RLS migration).';

-- Now that tenants exists, the deferred FKs from tenants -> referral_links/
-- referral_partners are added once those tables land (referrals migration);
-- see that file for the ALTER TABLE that attaches them.
