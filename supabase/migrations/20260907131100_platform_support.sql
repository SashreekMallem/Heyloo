-- Platform, support, API tokens. BACKEND_SPEC.md §1.9.

create table public.platform_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

comment on table public.platform_settings is
  'Admin-editable key/value store: price_card_<vertical> (base_cents, included_minutes, overage_cents), referral_flat_amount_cents, referral_qualification_rule, usage_alert_thresholds, segment_thresholds. Seeded in supabase/seed/.';

create table public.support_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  call_id uuid references public.call_logs(id),
  booking_id uuid references public.bookings(id),
  subject text not null,
  body text not null,
  priority text not null default 'medium' check (priority in ('low','medium','high','urgent')),
  status text not null default 'open' check (status in ('open','pending','resolved','closed')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_support_requests_tenant_status on public.support_requests (tenant_id, status);

create trigger trg_support_requests_updated_at
  before update on public.support_requests
  for each row execute function public.fn_set_updated_at();

create table public.support_request_notes (
  id uuid primary key default gen_random_uuid(),
  support_request_id uuid not null references public.support_requests(id),
  author_id uuid not null references auth.users(id),
  body text not null,
  visible_to_tenant boolean not null default false,
  created_at timestamptz not null default now()
);

create index idx_support_request_notes_request on public.support_request_notes (support_request_id);

create table public.api_tokens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  name text not null,
  token_hash text not null,
  token_prefix text not null,
  scopes jsonb not null default '["read"]'::jsonb,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_api_tokens_tenant on public.api_tokens (tenant_id);

comment on column public.api_tokens.token_hash is
  'sha256(token) — plaintext never stored. Full token shown to the tenant exactly once at creation (secret-reveal-once modal).';
