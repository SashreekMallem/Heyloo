-- Supporting tables approved by MASTER_SPEC.md §2 (introduced as `DECIDE:`
-- additions in BACKEND_SPEC.md at their point of use — §7.7 alerts, §7.8
-- demo_sessions, §7.9 provisioning_runs, §8 churn_scores, §10.3
-- airtable_sync_state, §10.4 push_subscriptions).

create table public.demo_sessions (
  id uuid primary key default gen_random_uuid(),
  business_name text not null,
  source_url text,
  vertical text,
  scraped_summary jsonb not null default '{}'::jsonb,
  sanitized boolean not null default false,
  agent_config_snapshot jsonb not null default '{}'::jsonb,
  retell_call_token text,
  demo_phone_e164 text,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now()
);

create index idx_demo_sessions_expires on public.demo_sessions (expires_at);

comment on table public.demo_sessions is
  'Ephemeral, pre-tenant. /api/demo-agent (§7.8) creates one per marketing-site demo; a nightly sweep (T4) deletes rows past expires_at. No real credentials — retell_call_token is a short-lived web-call token, not a durable secret.';

create table public.provisioning_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  step text not null
    check (step in ('tenant_finalize','agent_compile','twilio_number_provision',
                     'retell_number_import','billing_wiring','publish_agent','notify')),
  status text not null default 'pending' check (status in ('pending','in_progress','succeeded','failed')),
  error text,
  attempts int not null default 0,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint provisioning_runs_tenant_step_unique unique (tenant_id, step)
);

create index idx_provisioning_runs_tenant on public.provisioning_runs (tenant_id);

create trigger trg_provisioning_runs_updated_at
  before update on public.provisioning_runs
  for each row execute function public.fn_set_updated_at();

comment on table public.provisioning_runs is
  'One row per saga step (§7.9); the provisioning progress screen and retry logic both read this as the single source of truth.';

create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  rule text not null,
  severity text not null check (severity in ('info','warning','critical')),
  tenant_id uuid references public.tenants(id),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open','acked','resolved')),
  created_at timestamptz not null default now(),
  acked_at timestamptz,
  acked_by uuid references auth.users(id)
);

create index idx_alerts_status on public.alerts (status);
create index idx_alerts_tenant on public.alerts (tenant_id);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  endpoint text not null,
  keys jsonb not null,
  created_at timestamptz not null default now(),
  constraint push_subscriptions_endpoint_unique unique (endpoint)
);

create index idx_push_subscriptions_user on public.push_subscriptions (user_id);

comment on table public.push_subscriptions is
  'Per-user (not per-tenant, since a membership can have multiple users). Web Push (VAPID) fan-out is a secondary async delivery alongside the tenant-scoped realtime broadcast, never a replacement for it.';

create table public.churn_scores (
  tenant_id uuid primary key references public.tenants(id),
  score numeric not null,
  factors jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default now()
);

comment on table public.churn_scores is
  'Latest score only (upserted daily by the churn-scoring job, T4) — derived/overwritable rollup, not tenant identity.';

create table public.airtable_sync_state (
  tenant_id uuid not null references public.tenants(id),
  entity_type text not null check (entity_type in ('booking','order')),
  entity_id uuid not null,
  airtable_record_id text,
  last_synced_at timestamptz,
  content_hash text,
  sync_conflict boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (tenant_id, entity_type, entity_id)
);

comment on table public.airtable_sync_state is
  'One-way push (Heyloo -> tenant''s Airtable base) conflict tracking (G30): if the tenant edited the Airtable row since last_synced_at (detected via Airtable''s Last Modified Time), the next push flags sync_conflict instead of silently overwriting.';
